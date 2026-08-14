/**
 * Indicator math over a daily bar series, matching TradingView's default
 * formulas (SMA smoothing for the Stochastic, SMA-seeded EMAs for MACD).
 *
 * Warmup positions are `NaN` until enough history exists. Near the right edge of
 * a multi-month chart every value is well-defined, which is all the recency
 * window (≤ a few bars) cares about.
 */

export interface Bar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

/** Simple moving average. `out[i]` is the mean of the trailing `period` values. */
export function sma(values: readonly number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i]!;
    if (i >= period) sum -= values[i - period]!;
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** Exponential moving average, seeded with the SMA of the first `period` values. */
export function ema(values: readonly number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i]!;
  out[period - 1] = seed / period;
  for (let i = period; i < values.length; i++) {
    out[i] = values[i]! * k + out[i - 1]! * (1 - k);
  }
  return out;
}

export interface MacdSeries {
  macd: number[];
  signal: number[];
  histogram: number[];
}

/** MACD line = EMA(fast) − EMA(slow); signal = EMA of the MACD line. */
export function macdSeries(
  closes: readonly number[],
  fast: number,
  slow: number,
  signalPeriod: number,
): MacdSeries {
  const emaFast = ema(closes, fast);
  const emaSlow = ema(closes, slow);
  const macd = closes.map((_, i) =>
    Number.isNaN(emaFast[i]!) || Number.isNaN(emaSlow[i]!) ? NaN : emaFast[i]! - emaSlow[i]!,
  );

  // Signal = EMA(signalPeriod) of the MACD line, starting where MACD is defined.
  const firstValid = macd.findIndex((v) => !Number.isNaN(v));
  const signal = new Array<number>(closes.length).fill(NaN);
  if (firstValid !== -1) {
    const tail = macd.slice(firstValid);
    const tailEma = ema(tail, signalPeriod);
    for (let i = 0; i < tailEma.length; i++) signal[firstValid + i] = tailEma[i]!;
  }

  const histogram = macd.map((v, i) =>
    Number.isNaN(v) || Number.isNaN(signal[i]!) ? NaN : v - signal[i]!,
  );
  return { macd, signal, histogram };
}

export interface StochasticSeries {
  /** Smoothed %K (the faster line). */
  percentK: number[];
  /** %D; the signal line %K crosses. */
  percentD: number[];
}

/**
 * Slow Stochastic:
 *   raw %K = 100 * (close − lowestLow(kLength)) / (highestHigh − lowestLow)
 *   %K = SMA(raw %K, kSmoothing)
 *   %D = SMA(%K, dSmoothing)
 */
export function stochasticSeries(
  bars: readonly Bar[],
  kLength: number,
  kSmoothing: number,
  dSmoothing: number,
): StochasticSeries {
  const rawK = new Array<number>(bars.length).fill(NaN);
  for (let i = kLength - 1; i < bars.length; i++) {
    let lo = Infinity;
    let hi = -Infinity;
    for (let j = i - kLength + 1; j <= i; j++) {
      if (bars[j]!.low < lo) lo = bars[j]!.low;
      if (bars[j]!.high > hi) hi = bars[j]!.high;
    }
    const range = hi - lo;
    rawK[i] = range === 0 ? 50 : (100 * (bars[i]!.close - lo)) / range;
  }
  const percentK = sma(rawK.map((v) => (Number.isNaN(v) ? 0 : v)), kSmoothing).map((v, i) =>
    i < kLength - 1 + kSmoothing - 1 ? NaN : v,
  );
  const percentD = sma(percentK.map((v) => (Number.isNaN(v) ? 0 : v)), dSmoothing).map((v, i) =>
    i < kLength - 1 + kSmoothing - 1 + dSmoothing - 1 ? NaN : v,
  );
  return { percentK, percentD };
}
