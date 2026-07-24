import type { ChartImage } from '@stock-indicator-dailies/shared';

/** Why an acquisition attempt failed — drives retry vs. surface-to-user. */
export type ChartAcquisitionFailure =
  /** Session expired / not signed in. Needs a manual re-login, not a retry. */
  | 'not-authenticated'
  /** Expected chart elements missing — DOM likely shifted (see PRD: DOM volatility). */
  | 'chart-not-found'
  /**
   * Chart loaded on the wrong bar interval (e.g. hourly instead of daily), which
   * would compute every indicator over the wrong timeframe.
   */
  | 'wrong-interval'
  /** Ticker rejected by the provider. */
  | 'unknown-ticker'
  /** Timed out waiting for the chart to render. */
  | 'timeout'
  /** Anything else. */
  | 'unknown';

export class ChartAcquisitionError extends Error {
  readonly reason: ChartAcquisitionFailure;
  constructor(reason: ChartAcquisitionFailure, message: string) {
    super(message);
    this.name = 'ChartAcquisitionError';
    this.reason = reason;
  }
}

/**
 * Acquires a chart for a ticker: navigate, apply the fixed indicator set and
 * the 3-month window, and capture the chart region as an image.
 *
 * Implementations must screenshot the chart element only — never the full page —
 * so account chrome (balances, watchlists, account numbers) never enters the image.
 */
export interface ChartAgent {
  readonly name: string;
  acquire(ticker: string): Promise<ChartImage>;
}
