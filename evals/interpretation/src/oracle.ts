import {
  STOCHASTIC_THRESHOLDS,
  readingsFromSignals,
  type IndicatorReading,
  type IndicatorSignal,
} from '@stock-indicator-dailies/shared';

/**
 * Numeric indicator values read from TradingView's own legend at the last bar.
 * Each is labeled by the legend cell's `title` attribute, so there is no
 * positional guessing.
 */
export interface IndicatorValues {
  macd: {
    /** "MACD" plot: EMA(fast) − EMA(slow). */
    macd: number;
    /** "Signal line" plot. */
    signal: number;
    /** "Histogram" plot (MACD − signal). Included for completeness. */
    histogram: number;
  };
  stochastic: {
    /** "%K" plot — the faster line. */
    percentK: number;
    /** "%D" plot — the signal line %K crosses. */
    percentD: number;
  };
  /** "MA" plot value of the SMA study. */
  sma: number;
  /** Latest close, from the OHLC header. */
  close: number;
}

/**
 * ⚠️ STATE-BASED oracle, by necessity.
 *
 * A single legend snapshot gives the indicator values at the last bar only. It
 * cannot see the *previous* bar, so it cannot detect a fresh crossover event or
 * a slope direction. This oracle therefore grades the criteria as CURRENT-STATE
 * conditions, not crossover EVENTS:
 *
 *   - MACD BUY  : MACD line above signal AND below zero   (post bullish-cross-below-zero state)
 *   - MACD SELL : MACD line below signal AND above zero   (post bearish-cross-above-zero state)
 *   - Stoch BUY : %K above %D AND %K oversold  (< 20)
 *   - Stoch SELL: %K below %D AND %K overbought (> 80)
 *   - SMA BUY   : close above the SMA          (slope NOT checked — needs prior bar)
 *   - SMA SELL  : close below the SMA          (slope NOT checked)
 *
 * This is looser than the literal "crosses"/"with … slope" wording. It only
 * grades the VLM fairly if the VLM is judged on the same definition — see the
 * eval README for the state-vs-event decision.
 */

export function readMacd(v: IndicatorValues['macd']): IndicatorSignal {
  if (v.macd > v.signal && v.macd < 0) return 'BUY';
  if (v.macd < v.signal && v.macd > 0) return 'SELL';
  return 'NEUTRAL';
}

export function readStochastic(v: IndicatorValues['stochastic']): IndicatorSignal {
  if (v.percentK > v.percentD && v.percentK < STOCHASTIC_THRESHOLDS.oversold) return 'BUY';
  if (v.percentK < v.percentD && v.percentK > STOCHASTIC_THRESHOLDS.overbought) return 'SELL';
  return 'NEUTRAL';
}

/** Slope is unavailable from one snapshot, so only price-vs-SMA is graded. */
export function readSma(sma: number, close: number): IndicatorSignal {
  if (close > sma) return 'BUY';
  if (close < sma) return 'SELL';
  return 'NEUTRAL';
}

/** Ground-truth per-indicator readings computed from the legend values. */
export function oracleReadings(values: IndicatorValues): IndicatorReading[] {
  return readingsFromSignals([
    ['macd', readMacd(values.macd)],
    ['slowStochastic', readStochastic(values.stochastic)],
    ['sma', readSma(values.sma, values.close)],
  ]);
}
