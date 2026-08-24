import { chromium, type BrowserContext, type Locator, type Page } from 'playwright';

import type { ChartImage } from '@stock-indicator-dailies/shared';

import { ChartAcquisitionError, type ChartAgent } from './agent.ts';
import { hasAuthSession } from './auth.ts';
import { pacingFromEnv, pause, type PacingOptions } from './pacing.ts';
import { TRADINGVIEW, type ChartProviderProfile } from './profiles/tradingview.ts';
import { resolveProfileDir } from './session.ts';
import { extractIntervalToken } from './interval.ts';
import { validateStudies } from './studies.ts';

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
    if (await hasVisiblePopup(page)) {
      await dismissPopups(page);
      await page.waitForTimeout(500);
    }
    if (await hasVisiblePopup(page)) {
      const image = await screenshotChart(chart);
      throw new ChartAcquisitionError(
        'popup-blocking',
        'a promotional pop-up was still covering the chart after repeated dismissal attempts; ' +
          'the captured image would be partially or fully obscured',
        image,
      );
    }

    const buffer = await chart.screenshot({ type: 'png' });
    return { base64: buffer.toString('base64'), mediaType: 'image/png' };
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

/** Broad, generic "this looks like an overlay/modal/popup" selector set;
 * shared between the dismissal attempts and the final blocking check, so
 * the two stay in sync (a class dismissPopups doesn't recognize should
 * also not silently pass the pre-screenshot check). Case-insensitive `i`
 * flags because TradingView's own class names aren't consistent about it. */
const OVERLAY_SELECTORS = [
  '[class*="overlay" i]',
  '[class*="modal" i]',
  '[class*="popup" i]',
  '[class*="promo" i]',
  '[role="dialog"]',
  '[role="alertdialog"]',
];

/**
 * Dismiss TradingView popups/modals that can appear over the chart (upsell
 * offers, feature announcements, cookie banners). Clicks known dismiss buttons
 * and close icons, and falls back to pressing Escape. Swallows all failures;
 * a popup that isn't there is not an error. Called repeatedly (see
 * #waitForStudies and the pre-screenshot passes), so it's cheap and
 * idempotent by design, not a one-shot attempt.
 */
async function dismissPopups(page: Page): Promise<void> {
  // Text-based, not `button:has-text(...)`; TradingView's upsell modals style
  // these as plain <div>s, not <button> elements, so a tag-scoped selector
  // silently never matches. `:text()` matches any element by its text content.
  const dismissTexts = ['Decline offer', 'No, thanks', 'Maybe later', 'Not now'];

  for (const text of dismissTexts) {
    try {
      const el = page.locator(`:text("${text}")`).first();
      if (await el.isVisible({ timeout: 200 })) {
        await el.click();
        await page.waitForTimeout(300);
      }
    } catch {
      // not present or already gone
    }
  }

  // Generic modal close buttons/icons, by attribute or by a lone "×"/"✕"
  // glyph (the common icon-only close button that doesn't carry any
  // close-ish class or aria-label at all).
  const closeSelectors = [
    '[data-name="close"]',
    '[aria-label*="close" i]',
    '[class*="close" i]',
    'button:text-is("×")',
    '[role="button"]:text-is("×")',
    'button:text-is("✕")',
    '[role="button"]:text-is("✕")',
  ];
  for (const selector of closeSelectors) {
    try {
      const btn = page.locator(selector).first();
      if (await btn.isVisible({ timeout: 200 })) {
        await btn.click();
        await page.waitForTimeout(300);
      }
    } catch {
      // not present or already gone
    }
  }

  // Fallback: Escape key closes most overlay dialogs
  try {
    const overlay = page.locator(OVERLAY_SELECTORS.join(', ')).first();
    if (await overlay.isVisible({ timeout: 200 })) {
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
 * actually catches the case where a popup's markup didn't match any of its
 * selectors and it's still sitting there. */
async function hasVisiblePopup(page: Page): Promise<boolean> {
  try {
    return await page.locator(OVERLAY_SELECTORS.join(', ')).first().isVisible({ timeout: 200 });
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
