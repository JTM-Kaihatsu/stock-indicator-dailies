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
