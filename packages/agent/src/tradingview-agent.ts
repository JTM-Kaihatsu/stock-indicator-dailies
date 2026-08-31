import { chromium, type BrowserContext, type Locator, type Page } from 'playwright';

import type { ChartImage } from '@stock-indicator-dailies/shared';

import { ChartAcquisitionError, type ChartAgent } from './agent.ts';
import { hasAuthSession } from './auth.ts';
import { pacingFromEnv, pause, type PacingOptions } from './pacing.ts';
import { TRADINGVIEW, type ChartProviderProfile } from './profiles/tradingview.ts';
import { resolveProfileDir } from './session.ts';
import { extractIntervalToken } from './interval.ts';
import { validateStudies } from './studies.ts';
import { looksLikePopupOverlay } from './pixel-popup.ts';
import { hasForeignOverlayOverChart } from './dom-overlap.ts';
import { findUnpaintedPanes, getContentPaneBounds } from './pane-paint.ts';

/**
 * Standard flags for running headless Chromium under memory pressure
 * (small/shared-CPU hosts like a Render web service, CI runners, Docker).
 * Every capture launches a brand-new Chromium via
 * `launchPersistentContext` (see `acquire` below) — properly closed in a
 * `finally` either way, but TradingView is an unusually heavy, chart-
 * rendering-intensive SPA to run headlessly, and a plain `chromium.launch`
 * with no flags at all is tuned for a desktop environment, not a
 * memory-constrained container:
 *  - `--disable-dev-shm-usage`: containers often mount a tiny (~64MB)
 *    /dev/shm; Chromium's default shared-memory usage there can crash the
 *    renderer under load. This redirects that to /tmp instead.
 *  - `--disable-gpu` / `--disable-software-rasterizer`: no GPU compositing
 *    needed for a screenshot-only headless run; skips that process's
 *    memory entirely.
 *  - `--disable-extensions`, `--disable-background-networking`,
 *    `--disable-background-timer-throttling`,
 *    `--disable-backgrounding-occluded-windows`, `--no-first-run`: trims
 *    Chromium subsystems this one-shot, single-tab capture never uses.
 *  - `--js-flags=--max-old-space-size=256`: caps the *page's* V8 heap
 *    (TradingView's own JS), independent of the Node process's own heap.
 */
const CHROMIUM_LOW_MEMORY_ARGS = [
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--disable-software-rasterizer',
  '--disable-extensions',
  '--disable-background-networking',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--no-first-run',
  '--js-flags=--max-old-space-size=256',
];

export interface TradingViewChartAgentOptions {
  profileDir?: string;
  headless?: boolean;
  profile?: ChartProviderProfile;
  pacing?: PacingOptions;
  /** Max time to wait for the chart + studies to render. Default 45s. */
  renderTimeoutMs?: number;
  /**
   * Raster oversampling for the screenshot. Claude's vision API caps input images
   * at ~1.15MP regardless, so a 2× capture (~5.5MP) downscales to the exact same
   * pixels a 1× capture would after that cap; no extra detail reaches the model,
   * only extra render cost. Default 1.
   */
  deviceScaleFactor?: number;
}

/**
 * Captures a chart from the user's **saved TradingView layout**.
 *
 * The agent deliberately does not add or configure indicators; the layout
 * already carries them. It changes the symbol, pins the daily interval, verifies
 * the expected studies are actually present, and screenshots the chart element.
 *
 * Capture is scoped to the chart container, never the page, so watchlists and
 * account chrome cannot enter the image.
 */
export class TradingViewChartAgent implements ChartAgent {
  readonly name = 'tradingview';
  readonly #profileDir: string;
  readonly #headless: boolean;
  readonly #profile: ChartProviderProfile;
  readonly #pacing: PacingOptions;
  readonly #renderTimeoutMs: number;
  readonly #deviceScaleFactor: number;

  constructor(options: TradingViewChartAgentOptions = {}) {
    this.#profileDir = options.profileDir ?? resolveProfileDir();
    this.#headless = options.headless ?? process.env.AGENT_HEADLESS !== 'false';
    this.#profile = options.profile ?? TRADINGVIEW;
    this.#pacing = options.pacing ?? pacingFromEnv();
    this.#renderTimeoutMs = options.renderTimeoutMs ?? 45_000;
    this.#deviceScaleFactor = options.deviceScaleFactor ?? 1;
  }

  async acquire(ticker: string): Promise<ChartImage> {
    const context = await chromium.launchPersistentContext(this.#profileDir, {
      headless: this.#headless,
      viewport: { width: 1600, height: 1000 },
      deviceScaleFactor: this.#deviceScaleFactor,
      args: CHROMIUM_LOW_MEMORY_ARGS,
    });
    try {
      return await this.#capture(context, ticker.toUpperCase());
    } finally {
      await context.close();
    }
  }

  async #capture(context: BrowserContext, ticker: string): Promise<ChartImage> {
    const page = context.pages()[0] ?? (await context.newPage());

    try {
      await page.goto(this.#profile.chartUrl(ticker), {
        waitUntil: 'domcontentloaded',
        timeout: this.#renderTimeoutMs,
      });
    } catch {
      throw new ChartAcquisitionError('timeout', `timed out loading the chart for ${ticker}`);
    }

    // Auth is checked after navigation so the session cookies are populated.
    if (!(await hasAuthSession(context))) {
      throw new ChartAcquisitionError(
        'not-authenticated',
        'no signed-in session; run: npm run login -w @stock-indicator-dailies/agent',
      );
    }

    const chart = page.locator(this.#profile.selectors.chartContainer).first();
    try {
      await chart.waitFor({ state: 'visible', timeout: this.#renderTimeoutMs });
    } catch {
      throw new ChartAcquisitionError(
        'chart-not-found',
        `chart container ${this.#profile.selectors.chartContainer} never appeared; the provider DOM may have changed`,
      );
    }

    await dismissPopups(page);
    await pause(this.#pacing);

    // Structural validation: every required study must be on the chart with the
    // expected parameters AND have actually rendered its plotted values before the
    // image is allowed anywhere near the VLM. The name check alone is a prefix
    // match, so it passes even when the pane is still blank; the value check is
    // what proves the study painted. On failure we still screenshot, so the
    // caller can *see* the blank chart that was rejected.
    //
    // Popups get dismissed continuously *during* this wait (see #waitForStudies),
    // not just before/after it; a promo modal that arrives mid-poll used to sit
    // there undetected for however long the studies took to finish rendering.
    const validation = await this.#waitForStudies(page);
    if (!validation.ok) {
      const image = await screenshotChart(chart);
      if (validation.notRendered.length > 0) {
        throw new ChartAcquisitionError(
          'studies-not-rendered',
          `studies are on the layout but did not finish rendering before the deadline: ` +
            `${validation.notRendered.join(', ')}. The chart would be captured with blank panes ` +
            `(the saved image shows the empty state).`,
          image,
        );
      }
      throw new ChartAcquisitionError(
        'chart-not-found',
        `expected studies missing from the layout: ${validation.missing.join(', ')}. ` +
          `Check that your saved layout still has them with the right parameters.`,
        image,
      );
    }

    // Verify the bar interval. An intraday chart would compute every study over
    // the wrong timeframe, and the image gives no hint that anything is wrong.
    const texts = await readLegendTexts(page);
    const interval = extractIntervalToken(texts);
    if (interval !== this.#profile.interval.displayToken) {
      const image = await screenshotChart(chart);
      throw new ChartAcquisitionError(
        'wrong-interval',
        `chart is on "${interval ?? 'unknown'}" bars, expected "${this.#profile.interval.displayToken}"; ` +
          `indicators would be computed over the wrong timeframe`,
        image,
      );
    }

    // Some upsell modals arrive on a delay timer rather than immediately, so a
    // single check right before the screenshot can still miss one that pops up
    // a moment later. Two passes, spaced out, catch that without much cost.
    await dismissPopups(page);
    await page.waitForTimeout(1000);
    await dismissPopups(page);

    // The screenshot is taken at this point precisely because it's the point
    // right after the reads are validated (studies rendered, interval correct)
    // and popups dismissed; not earlier. But dismissPopups swallows failures by
    // design (a popup that isn't there is fine), so it can silently fail to
    // close one whose markup doesn't match its selectors. Fail closed rather
    // than silently sending Claude a chart with a promo banner over it: one
    // more attempt, then verify, then give up loudly with the evidence attached.
    //
    // Two independent checks, not one: hasVisiblePopup only recognizes a
    // known selector; hasForeignOverlayOverChart doesn't care what a popup
    // looks like or is classed as, only whether *something* outside the
    // chart is geometrically sitting on top of it — the two catch different
    // failure modes (see dom-overlap.ts for why the selector-based one alone
    // isn't enough).
    if ((await hasVisiblePopup(page)) || (await hasForeignOverlayOverChart(page, this.#profile.selectors.chartContainer))) {
      await dismissPopups(page);
      await page.waitForTimeout(500);
    }
    if ((await hasVisiblePopup(page)) || (await hasForeignOverlayOverChart(page, this.#profile.selectors.chartContainer))) {
      const image = await screenshotChart(chart);
      throw new ChartAcquisitionError(
        'popup-blocking',
        'a promotional pop-up was still covering the chart after repeated dismissal attempts; ' +
          'the captured image would be partially or fully obscured',
        image,
      );
    }

    // A settle wait, not a redundant one: a popup that just closed (dismissed
    // above) can still be mid-exit-transition, and the chart container can
    // still be reflowing as the overlay/backdrop is removed. Playwright's own
    // screenshot has a stability wait that will time out chasing a layout
    // that's still actively moving; giving it a settled starting point avoids
    // racing that transition (observed live: "waiting for element to be
    // stable" timing out at ~28s right after a popup dismissal).
    await page.waitForTimeout(500);
    const image = await this.#screenshotChartOrThrow(page, chart);

    // hasVisiblePopup above passed, but pixel analysis says otherwise: a
    // popup whose markup didn't match any known selector. Give dismissal one
    // more real attempt (not just cosmetic) before giving up — the same
    // reasoning as the DOM-based retry above, just for the case that check
    // couldn't see.
    if (await looksLikePopupOverlay(page, image.base64)) {
      await dismissPopups(page);
      await page.waitForTimeout(1000);
      await dismissPopups(page);
      await page.waitForTimeout(500);
      const retryImage = await this.#screenshotChartOrThrow(page, chart);
      if (await looksLikePopupOverlay(page, retryImage.base64)) {
        throw new ChartAcquisitionError(
          'popup-blocking',
          'pixel analysis found a large anomalous dark region over the chart after retrying dismissal, ' +
            "consistent with an undetected pop-up; the DOM-based checks didn't see it, so its markup likely " +
            "doesn't match any known selector",
          retryImage,
        );
      }
      return this.#verifyPanesPaintedOrThrow(page, chart, retryImage);
    }

    return this.#verifyPanesPaintedOrThrow(page, chart, image);
  }

  /**
   * Backstop against a pane whose legend claims a value but whose lines
   * never actually painted — observed live: MACD and Slow Stochastic both
   * showed real, finite legend values (so `#waitForStudies`'s
   * `validateStudies` check, DOM-text-based, correctly called them
   * "rendered") while the panes were visually blank in the captured image.
   * That check has no way to catch this; it only ever reads legend text,
   * and TradingView had decoupled that text updating from the canvas
   * actually repainting for that one capture. See pane-paint.ts for the
   * pixel-level detail.
   */
  async #verifyPanesPaintedOrThrow(page: Page, chart: Locator, image: ChartImage): Promise<ChartImage> {
    const panes = await getContentPaneBounds(page, this.#profile.selectors.chartContainer);
    // Fixed by the saved layout, confirmed live: price (with the SMA
    // overlay) is pane 0, MACD is pane 1, Slow Stochastic is pane 2. Not
    // derived from `expectedStudies`' array order (macd, slowStochastic,
    // sma) — that's a declaration order, unrelated to on-screen position.
    // Skip the check entirely if the layout doesn't have the panes this
    // assumes; a capture-infrastructure surprise shouldn't block on a
    // diagnostic that no longer applies to it.
    if (panes.length < 3) return image;

    // Same "no DOM lib in this package's tsconfig" reasoning as elsewhere
    // in this file: reach getBoundingClientRect via an unknown cast rather
    // than a browser-only element type.
    const chartCssHeight = await chart.evaluate(
      (el) => (el as unknown as { getBoundingClientRect(): { height: number } }).getBoundingClientRect().height,
    );
    const [macdUnpainted, stochUnpainted] = await findUnpaintedPanes(page, image.base64, [panes[1]!, panes[2]!], chartCssHeight);

    if (!macdUnpainted && !stochUnpainted) return image;

    await dismissPopups(page);
    await page.waitForTimeout(1500);
    const retryImage = await this.#screenshotChartOrThrow(page, chart);
    const [macdStillUnpainted, stochStillUnpainted] = await findUnpaintedPanes(page, retryImage.base64, [panes[1]!, panes[2]!], chartCssHeight);
    if (macdStillUnpainted || stochStillUnpainted) {
      const which = [macdStillUnpainted && 'MACD', stochStillUnpainted && 'Slow Stochastic'].filter(Boolean).join(' and ');
      throw new ChartAcquisitionError(
        'studies-not-rendered',
        `${which} pane's legend has values but its plotted lines never painted (pixel check found no ` +
          `blue/orange line color in the pane), even after retrying; the captured image would show a blank pane`,
        retryImage,
      );
    }
    return retryImage;
  }

  /** Screenshots the chart (does not itself check for a popup — that's the
   * caller's job via `looksLikePopupOverlay`), translating a Playwright timeout into a typed
   * ChartAcquisitionError instead of letting it bubble up as a raw error
   * (which run-daily.ts would otherwise bucket as an undifferentiated
   * `reason: 'unknown'`). Shared by the initial screenshot and the
   * pixel-check retry below, so both fail the same way. */
  async #screenshotChartOrThrow(page: Page, chart: Locator): Promise<ChartImage> {
    try {
      const buffer = await chart.screenshot({ type: 'png', timeout: 45_000 });
      return { base64: buffer.toString('base64'), mediaType: 'image/png' };
    } catch (err) {
      throw new ChartAcquisitionError(
        'timeout',
        `timed out screenshotting the chart (layout never settled): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Poll the legend until every expected study is present AND has rendered its
   * plotted values (or we give up). Both signals are read each tick: the name
   * strings, and the live per-plot values.
   *
   * Also presses Escape each tick; this loop can legitimately run for tens of
   * seconds, long enough for a delayed promo modal to arrive and sit
   * unaddressed if it were only handled before/after the wait. Escape alone
   * (not the full dismissPopups sweep) on purpose: this runs up to ~45 times
   * per capture, and dismissPopups' dozen locator checks at that frequency
   * would meaningfully slow down every single capture. The full sweep still
   * runs right before the screenshot, where its extra thoroughness matters
   * more than its cost.
   */
  async #waitForStudies(page: Page) {
    const deadline = Date.now() + this.#renderTimeoutMs;
    let last = validateStudies([], this.#profile.expectedStudies);

    while (Date.now() < deadline) {
      await page.keyboard.press('Escape').catch(() => {});
      const [texts, values] = await Promise.all([readLegendTexts(page), readLegendValues(page)]);
      last = validateStudies(texts, this.#profile.expectedStudies, values);
      if (last.ok) return last;
      await page.waitForTimeout(1000);
    }
    return last;
  }
}

/**
 * TradingView renders essentially every dialog/popup/tooltip/dropdown into
 * this single root container (an "overlay manager" pattern common in large
 * SPAs), confirmed live against a real, recurring promo popup that no
 * amount of broadening the class-name selectors alone ever caught. It's a
 * plain, semantic id (not a build-hash like the CSS-module classes
 * elsewhere on the page), so it's reasonably safe to rely on.
 *
 * Scoping to it fixes two failure modes found by direct testing:
 *  1. `.first()` on a broad, page-wide "class contains modal/overlay/..."
 *     selector picks the first DOM-order match across the *whole page*,
 *     which is very often a hidden dialog template for some other feature
 *     (this SPA has many), not the one actually on screen. Checking that
 *     hidden element's visibility correctly returns false, so the real,
 *     visible popup elsewhere in DOM order is never even examined.
 *  2. A page-wide close-button search can match a genuinely visible but
 *     unrelated "close"-labeled button elsewhere on the chart's own
 *     toolbar, and clicking it hangs on Playwright's actionability checks
 *     (observed live: a 30s timeout on `.click()`) instead of erroring
 *     immediately, since Playwright waits for wrong the target to become
 *     "actionable" (i.e never), rather than fast-failing.
 * Falls back to an unscoped page-wide search when the root isn't present,
 * in case some other popup type (e.g. a cookie banner) renders outside it.
 */
const OVERLAY_ROOT_SELECTOR = '#overlap-manager-root';

/**
 * Promo/notification toasts (e.g. "End of Summer sale awaits") render in a
 * *separate* layer, a sibling of #overlap-manager-root under <body>
 * (confirmed live: div.toastLayerChart-<hash> > section.toastList-<hash> >
 * ...), not nested inside it. Scoping OVERLAY_ROOT_SELECTOR therefore can
 * never see them, which is exactly why one kept surviving every previous
 * fix here. TradingView's build hashes every other class on these elements,
 * but consistently keeps the literal word "toast" in the class name itself
 * (BEM-style: `toastLayerChart-h0NSCjCQ`), so that's the stable hook.
 *
 * The close icon inside each toast card has no stable selector at all (no
 * aria-label, a hashed "iconOnly" button class shared with unrelated UI),
 * so rather than hunting for it, this hides the entire toast layer outright
 * via direct style manipulation. That's safe: it's a passive notification
 * stack, not something the capture needs to interact with, just something
 * that must not visually cover the chart.
 */
const TOAST_LAYER_SELECTOR = '[class*="toastLayerChart" i], [class*="toastList" i]';
const TOAST_LAYER_VISIBLE_SELECTOR = '[class*="toastLayerChart" i]:visible, [class*="toastList" i]:visible';

/** Case-insensitive `i` flags because TradingView's own class names aren't
 * consistent about it. `:visible` is a Playwright selector-engine
 * extension (not standard CSS); combined with scoping to the overlay root
 * (or, in the fallback, checked via `.count()` instead of `.first()`), this
 * is what actually finds the one that's on screen instead of a same-named
 * hidden element elsewhere in the DOM. */
const OVERLAY_SELECTORS = [
  '[class*="overlay" i]:visible',
  '[class*="modal" i]:visible',
  '[class*="popup" i]:visible',
  '[class*="promo" i]:visible',
  '[role="dialog"]:visible',
  '[role="alertdialog"]:visible',
];

const CLOSE_SELECTORS = [
  '[data-name="close"]:visible',
  '[aria-label*="close" i]:visible',
  '[class*="close" i]:visible',
  'button:text-is("×"):visible',
  '[role="button"]:text-is("×"):visible',
  'button:text-is("✕"):visible',
  '[role="button"]:text-is("✕"):visible',
];

// No bare "OK": :text() does case-insensitive substring matching, so a
// short, common word risks matching unrelated visible page text once this
// is scoped to the whole page rather than just the overlay root (feature
// tooltips like the "Magnet mode is on" one aren't always rendered inside
// #overlap-manager-root the way modals are).
const DISMISS_TEXTS = ['Decline offer', 'No, thanks', 'Maybe later', 'Not now', 'Got it!', 'Got it', 'Dismiss'];

/** Prefixes each selector with the overlay root when it's present on the
 * page, so a match is guaranteed to be an actual dialog/popup, not some
 * unrelated visible "close"/"modal"-classed element in the main chart UI. */
async function scopedSelectors(page: Page, selectors: string[]): Promise<string[]> {
  const hasRoot = (await page.locator(OVERLAY_ROOT_SELECTOR).count()) > 0;
  if (!hasRoot) return selectors;
  return selectors.map((s) => `${OVERLAY_ROOT_SELECTOR} ${s}`);
}

/**
 * Dismiss TradingView popups/modals that can appear over the chart (upsell
 * offers, feature announcements, cookie banners). Clicks known dismiss
 * buttons and close icons, and falls back to pressing Escape. Swallows all
 * failures; a popup that isn't there is not an error. Called repeatedly
 * (see #waitForStudies and the pre-screenshot passes), so it's cheap and
 * idempotent by design, not a one-shot attempt.
 */
async function dismissPopups(page: Page): Promise<void> {
  try {
    await page.evaluate((selector) => {
      // Same `document`-via-`globalThis` pattern as readLegendTexts below,
      // so this package's own tsconfig doesn't need the DOM lib.
      const doc = (
        globalThis as unknown as {
          document: { querySelectorAll(selector: string): ArrayLike<{ style: { display: string } }> };
        }
      ).document;
      Array.from(doc.querySelectorAll(selector)).forEach((el) => {
        el.style.display = 'none';
      });
    }, TOAST_LAYER_SELECTOR);
  } catch {
    // page not ready yet, or nothing matched
  }

  for (const text of DISMISS_TEXTS) {
    try {
      const el = page.locator(`:text("${text}"):visible`).first();
      if ((await el.count()) > 0) {
        await el.click({ timeout: 2000 });
        await page.waitForTimeout(300);
      }
    } catch {
      // not present, already gone, or didn't become actionable in time
    }
  }

  const closeSelectors = await scopedSelectors(page, CLOSE_SELECTORS);
  for (const selector of closeSelectors) {
    try {
      const btn = page.locator(selector).first();
      if ((await btn.count()) > 0) {
        await btn.click({ timeout: 2000 });
        await page.waitForTimeout(300);
      }
    } catch {
      // not present, already gone, or didn't become actionable in time
    }
  }

  // Fallback: Escape key closes most overlay dialogs
  try {
    const overlaySelectors = await scopedSelectors(page, OVERLAY_SELECTORS);
    if ((await page.locator(overlaySelectors.join(', ')).count()) > 0) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }
  } catch {
    // nothing to dismiss
  }
}

/** Whether anything overlay-shaped is still visible over the chart, after
 * dismissal attempts. Used as the fail-closed check right before the final
 * screenshot: dismissPopups swallows failures by design, so this is what
 * actually catches the case where a popup is still sitting there. `.count()`,
 * not `.first().isVisible()`: every candidate selector already has
 * `:visible` baked in (see OVERLAY_SELECTORS), so any match at all is by
 * definition something currently on screen. */
async function hasVisiblePopup(page: Page): Promise<boolean> {
  try {
    const overlaySelectors = await scopedSelectors(page, OVERLAY_SELECTORS);
    // The toast layer lives outside #overlap-manager-root (see
    // TOAST_LAYER_SELECTOR), so it's checked unscoped, in addition to the
    // scoped overlay selectors above, not instead of them.
    const combined = [...overlaySelectors, TOAST_LAYER_VISIBLE_SELECTOR].join(', ');
    return (await page.locator(combined).count()) > 0;
  } catch {
    return false;
  }
}

/** Screenshot the chart element, swallowing failures; for diagnostic capture. */
async function screenshotChart(chart: Locator): Promise<ChartImage | undefined> {
  try {
    const buffer = await chart.screenshot({ type: 'png' });
    return { base64: buffer.toString('base64'), mediaType: 'image/png' };
  } catch {
    return undefined;
  }
}

/**
 * Pull candidate study-legend strings out of the page.
 *
 * TradingView gives the legend no stable hook, so we collect short strings that
 * look like `NAME[source]params...` and let the study patterns do the matching.
 * Over-collecting is safe; validation only cares about matches.
 */
export async function readLegendTexts(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    // `document` exists only in the page. We reach it through globalThis rather
    // than referencing the DOM global directly: this package ships TypeScript
    // sources, so a bare `document` would force every downstream consumer to add
    // "DOM" to its tsconfig `lib` just to compile us.
    const doc = (
      globalThis as unknown as {
        document: { querySelectorAll(selector: string): ArrayLike<{ textContent: string | null }> };
      }
    ).document;

    const texts = Array.from(doc.querySelectorAll('div,span'))
      .map((el) => (el.textContent ?? '').trim())
      .filter((t) => t.length > 0 && t.length < 80 && /^[A-Za-z]{2,14}/.test(t));
    return Array.from(new Set(texts));
  });
}

/**
 * Read each study's live legend VALUES, keyed by the plot's `title` (e.g.
 * `MACD`, `Signal line`, `Histogram`, `%K`, `%D`, `MA`). A study that is on the
 * layout but has not painted yet shows no value here; which is how we tell a
 * rendered chart from a blank one. Mirrors `calibrate-live.ts`'s extraction.
 */
export async function readLegendValues(page: Page): Promise<Record<string, number>> {
  return page.evaluate(() => {
    const doc = (
      globalThis as unknown as {
        document: {
          querySelectorAll(selector: string): ArrayLike<{
            getAttribute(name: string): string | null;
            textContent: string | null;
          }>;
        };
      }
    ).document;

    // TradingView renders negatives with the Unicode minus U+2212; normalize it.
    const parse = (s: string) => Number(s.replace(/−/g, '-').replace(/[^0-9.\-]/g, ''));
    const values: Record<string, number> = {};
    for (const el of Array.from(doc.querySelectorAll('[class*="valueValue"]'))) {
      const title = el.getAttribute('title');
      const num = parse(el.textContent ?? '');
      if (title && Number.isFinite(num)) values[title] = num;
    }
    return values;
  });
}
