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
  /** Slow Stochastic: %K 14, %D 5. */
  slowStochastic: { percentK: 14, percentD: 5 },
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
 * The chart's visible time window. All three indicators are read over the same
 * 3-month range, so the agent must set the chart timeframe accordingly before
 * capture, and the VLM prompt / eval labels assume this window.
 */
export const CHART_WINDOW = {
  /** Calendar months of price history displayed on the chart. */
  months: 3,
  /** Short range label for UI and provider selectors (e.g. TradingView "3M"). */
  label: '3M',
} as const;
