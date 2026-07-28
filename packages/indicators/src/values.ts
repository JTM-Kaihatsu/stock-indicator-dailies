/**
 * Indicator values at a single bar. Two things produce this shape and must
 * agree: our own computation over the price series, and the numbers TradingView
 * renders in its legend — which is exactly what calibration checks.
 */
export interface IndicatorValues {
  macd: {
    /** "MACD" plot: EMA(fast) − EMA(slow). */
    macd: number;
    /** "Signal line" plot. */
    signal: number;
    /** "Histogram" plot (MACD − signal). */
    histogram: number;
  };
  stochastic: {
    /** "%K" plot — the faster line. */
    percentK: number;
    /** "%D" plot — the signal line. */
    percentD: number;
  };
  /** "MA" plot value of the SMA study. */
  sma: number;
  /** Latest close. */
  close: number;
}
