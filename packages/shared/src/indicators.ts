import type { IndicatorKey } from './types.ts';

/**
 * All indicator keys in canonical order. Runtime companion to the
 * {@link IndicatorKey} type; the `satisfies` clause fails the build if the two
 * ever drift apart.
 */
export const INDICATOR_KEYS = [
  'macd',
  'slowStochastic',
  'sma',
] as const satisfies readonly IndicatorKey[];

/**
 * Fixed indicator parameters — the single source of truth consumed by the
 * agent (to configure the chart), the VLM prompt (to describe what it's reading),
 * and the eval suites (to label ground truth).
 *
 * These come directly from the PRD and must not be changed casually: every
 * captured chart and every ground-truth label assumes exactly these settings.
 */
export const INDICATOR_PARAMS = {
  /** MACD: Fast Length 8, Slow Length 17, Signal Smoothing 9. */
  macd: { fastLength: 8, slowLength: 17, signalSmoothing: 9 },
  /**
   * Slow Stochastic, as three parameters:
   * - `percentKLength` — lookback window for the high/low range.
   * - `percentKSmoothing` — moving average applied to raw %K (this is what
   *   makes it "slow"; 1 would be a Fast Stochastic).
   * - `percentDSmoothing` — moving average of %K, producing the %D signal line
   *   that %K crosses.
   *
   * These mirror the live "Rule 1" TradingView layout (`Stoch 14 5 3`), which is
   * authoritative — the chart, this spec, and the VLM prompt must agree or every
   * signal measures a setup that isn't on screen.
   */
  slowStochastic: { percentKLength: 14, percentKSmoothing: 5, percentDSmoothing: 3 },
  /** Simple Moving Average: period 10. */
  sma: { period: 10 },
} as const;

/**
 * Slow Stochastic oversold / overbought bands used by the buy/sell criteria.
 * Buy requires the %K/%D crossover to occur while oversold (< 20);
 * sell requires it while overbought (> 80).
 */
export const STOCHASTIC_THRESHOLDS = {
  oversold: 20,
  overbought: 80,
} as const;

/**
 * How the chart is framed.
 *
 * `interval` is the load-bearing part: every indicator parameter above is
 * defined on DAILY closes. An intraday chart silently computes a "10-day SMA"
 * over 10 hours, so the agent pins and verifies the interval.
 *
 * The visible span is deliberately NOT pinned. TradingView stores a zoom level
 * (pixels per bar), not a time range — so the visible months vary with the saved
 * layout and the rendering viewport width, and its date axis is canvas-drawn and
 * unreadable by script. The VLM reports the range it actually sees
 * (`Verdict.visibleRange`) instead of us asserting a number we can't control.
 * Span affects only how much history is visible, never the indicator values.
 */
/**
 * Success targets from the PRD, kept next to the domain constants so code can
 * measure itself against them rather than restating numbers in prose.
 */
export const SUCCESS_TARGETS = {
  /** Acquisition + analysis should complete within 15 seconds. */
  timeToSignalMs: 15_000,
  /** Chart retrieval vs. the labeled test set (SSIM). */
  retrievalSsim: 0.95,
  /** Buy/sell/hold interpretation vs. labeled ground truth. */
  interpretationAccuracy: 1.0,
} as const;

export const CHART_WINDOW = {
  /** Bar interval the indicators are computed on. */
  interval: 'daily',
  /** Rough expectation for the visible history; observational, not enforced. */
  approximateMonths: 6,
} as const;
