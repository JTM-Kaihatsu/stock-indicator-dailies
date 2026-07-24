import { chromium, type BrowserContext, type Page } from 'playwright';

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
}

/**
 * Captures a chart from the user's **saved TradingView layout**.
 *
 * The agent deliberately does not add or configure indicators — the layout
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

  constructor(options: TradingViewChartAgentOptions = {}) {
    this.#profileDir = options.profileDir ?? resolveProfileDir();
    this.#headless = options.headless ?? process.env.AGENT_HEADLESS !== 'false';
    this.#profile = options.profile ?? TRADINGVIEW;
    this.#pacing = options.pacing ?? pacingFromEnv();
    this.#renderTimeoutMs = options.renderTimeoutMs ?? 45_000;
  }

  async acquire(ticker: string): Promise<ChartImage> {
    const context = await chromium.launchPersistentContext(this.#profileDir, {
      headless: this.#headless,
      viewport: { width: 1600, height: 1000 },
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
        'no signed-in session — run: npm run login -w @stock-indicator-dailies/agent',
      );
    }

    const chart = page.locator(this.#profile.selectors.chartContainer).first();
    try {
      await chart.waitFor({ state: 'visible', timeout: this.#renderTimeoutMs });
    } catch {
      throw new ChartAcquisitionError(
        'chart-not-found',
        `chart container ${this.#profile.selectors.chartContainer} never appeared — the provider DOM may have changed`,
      );
    }

    await pause(this.#pacing);

    // Structural validation: every required study must be on the chart with the
    // expected parameters before the image is allowed anywhere near the VLM.
    const validation = await this.#waitForStudies(page);
    if (!validation.ok) {
      throw new ChartAcquisitionError(
        'chart-not-found',
        `expected studies missing from the layout: ${validation.missing.join(', ')}. ` +
          `Check that your saved layout still has them with the right parameters.`,
      );
    }

    // Verify the bar interval. An intraday chart would compute every study over
    // the wrong timeframe, and the image gives no hint that anything is wrong.
    const texts = await readLegendTexts(page);
    const interval = extractIntervalToken(texts);
    if (interval !== this.#profile.interval.displayToken) {
      throw new ChartAcquisitionError(
        'wrong-interval',
        `chart is on "${interval ?? 'unknown'}" bars, expected "${this.#profile.interval.displayToken}" — ` +
          `indicators would be computed over the wrong timeframe`,
      );
    }

    const buffer = await chart.screenshot({ type: 'png' });
    return { base64: buffer.toString('base64'), mediaType: 'image/png' };
  }

  /** Poll the legend until every expected study renders (or we give up). */
  async #waitForStudies(page: Page) {
    const deadline = Date.now() + this.#renderTimeoutMs;
    let last = validateStudies([], this.#profile.expectedStudies);

    while (Date.now() < deadline) {
      last = validateStudies(await readLegendTexts(page), this.#profile.expectedStudies);
      if (last.ok) return last;
      await page.waitForTimeout(1000);
    }
    return last;
  }
}

/**
 * Pull candidate study-legend strings out of the page.
 *
 * TradingView gives the legend no stable hook, so we collect short strings that
 * look like `NAME[source]params...` and let the study patterns do the matching.
 * Over-collecting is safe — validation only cares about matches.
 */
export async function readLegendTexts(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const texts = Array.from(document.querySelectorAll('div,span'))
      .map((el) => (el.textContent ?? '').trim())
      .filter((t) => t.length > 0 && t.length < 80 && /^[A-Za-z]{2,14}/.test(t));
    return Array.from(new Set(texts));
  });
}
