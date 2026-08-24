import type { ChartImage } from '@stock-indicator-dailies/shared';

/** Why an acquisition attempt failed; drives retry vs. surface-to-user. */
export type ChartAcquisitionFailure =
  /** Session expired / not signed in. Needs a manual re-login, not a retry. */
  | 'not-authenticated'
  /** Expected chart elements missing; DOM likely shifted (see PRD: DOM volatility). */
  | 'chart-not-found'
  /**
   * The studies are on the layout (their legend names match) but their plotted
   * values never rendered before the deadline; the chart would be captured with
   * blank oscillator panes. A rendering/timing failure, distinct from missing.
   */
  | 'studies-not-rendered'
  /**
   * Chart loaded on the wrong bar interval (e.g. hourly instead of daily), which
   * would compute every indicator over the wrong timeframe.
   */
  | 'wrong-interval'
  /** Ticker rejected by the provider. */
  | 'unknown-ticker'
  /** Timed out waiting for the chart to render. */
  | 'timeout'
  /**
   * A promotional popup/modal was still covering the chart after repeated
   * dismissal attempts, right before the screenshot would have been taken.
   * Distinct from `chart-not-found`/`studies-not-rendered`: the chart itself
   * rendered fine, but the image would show it partially or fully obscured.
   */
  | 'popup-blocking'
  /** Anything else. */
  | 'unknown';

export class ChartAcquisitionError extends Error {
  readonly reason: ChartAcquisitionFailure;
  /**
   * The chart image at the moment of failure, when one could still be captured
   * (e.g. studies didn't render, or the interval was wrong); so callers can save
   * it and *see* why the chart was rejected instead of guessing.
   */
  readonly image?: ChartImage;
  constructor(reason: ChartAcquisitionFailure, message: string, image?: ChartImage) {
    super(message);
    this.name = 'ChartAcquisitionError';
    this.reason = reason;
    if (image) this.image = image;
  }
}

/**
 * Acquires a chart for a ticker: navigate, apply the fixed indicator set and
 * the 3-month window, and capture the chart region as an image.
 *
 * Implementations must screenshot the chart element only, never the full page,
 * so account chrome (balances, watchlists, account numbers) never enters the image.
 */
export interface ChartAgent {
  readonly name: string;
  acquire(ticker: string): Promise<ChartImage>;
}
