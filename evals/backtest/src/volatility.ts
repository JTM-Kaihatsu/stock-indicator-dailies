import type { Bar } from '@stock-indicator-dailies/indicators';

/**
 * ATR and ADX; Wilder's original smoothing. Scoped to the backtest package
 * rather than `packages/indicators`: these are strategy-execution filters for
 * the simulator (noise reduction, trend-strength gating), not part of the
 * app's actual "Three Tools" (MACD/Stochastic/SMA) indicator set the live
 * report shows.
 */

function trueRange(bars: readonly Bar[], i: number): number {
  if (i === 0) return bars[0]!.high - bars[0]!.low;
  const prevClose = bars[i - 1]!.close;
  return Math.max(
    bars[i]!.high - bars[i]!.low,
    Math.abs(bars[i]!.high - prevClose),
    Math.abs(bars[i]!.low - prevClose),
  );
}

/** Average True Range. `out[i]` is NaN until `period` bars of true range exist. */
export function atr(bars: readonly Bar[], period = 14): number[] {
  const n = bars.length;
  const out = new Array<number>(n).fill(NaN);
  if (n < period + 1) return out;

  const tr = bars.map((_, i) => trueRange(bars, i));
  let seed = 0;
  for (let i = 1; i <= period; i++) seed += tr[i]!;
  out[period] = seed / period;
  for (let i = period + 1; i < n; i++) {
    out[i] = (out[i - 1]! * (period - 1) + tr[i]!) / period;
  }
  return out;
}

/**
 * Average Directional Index; trend strength on a 0-100 scale, direction-
 * agnostic (a strong downtrend reads just as high as a strong uptrend).
 * Needs roughly `2 * period` bars before the first value; NaN before that.
 */
export function adx(bars: readonly Bar[], period = 14): number[] {
  const n = bars.length;
  const out = new Array<number>(n).fill(NaN);
  if (n < period * 2) return out;

  const tr = new Array<number>(n).fill(0);
  const plusDM = new Array<number>(n).fill(0);
  const minusDM = new Array<number>(n).fill(0);
  for (let i = 1; i < n; i++) {
    tr[i] = trueRange(bars, i);
    const upMove = bars[i]!.high - bars[i - 1]!.high;
    const downMove = bars[i - 1]!.low - bars[i]!.low;
    plusDM[i] = upMove > downMove && upMove > 0 ? upMove : 0;
    minusDM[i] = downMove > upMove && downMove > 0 ? downMove : 0;
  }

  const smoothTR = new Array<number>(n).fill(NaN);
  const smoothPlusDM = new Array<number>(n).fill(NaN);
  const smoothMinusDM = new Array<number>(n).fill(NaN);
  let sumTR = 0;
  let sumPlus = 0;
  let sumMinus = 0;
  for (let i = 1; i <= period; i++) {
    sumTR += tr[i]!;
    sumPlus += plusDM[i]!;
    sumMinus += minusDM[i]!;
  }
  smoothTR[period] = sumTR;
  smoothPlusDM[period] = sumPlus;
  smoothMinusDM[period] = sumMinus;
  for (let i = period + 1; i < n; i++) {
    smoothTR[i] = smoothTR[i - 1]! - smoothTR[i - 1]! / period + tr[i]!;
    smoothPlusDM[i] = smoothPlusDM[i - 1]! - smoothPlusDM[i - 1]! / period + plusDM[i]!;
    smoothMinusDM[i] = smoothMinusDM[i - 1]! - smoothMinusDM[i - 1]! / period + minusDM[i]!;
  }

  const dx = new Array<number>(n).fill(NaN);
  for (let i = period; i < n; i++) {
    if (smoothTR[i] === 0) continue;
    const plusDI = (100 * smoothPlusDM[i]!) / smoothTR[i]!;
    const minusDI = (100 * smoothMinusDM[i]!) / smoothTR[i]!;
    const sum = plusDI + minusDI;
    dx[i] = sum === 0 ? 0 : (100 * Math.abs(plusDI - minusDI)) / sum;
  }

  const firstAdxIndex = Math.min(2 * period, n) - 1;
  let dxSum = 0;
  let count = 0;
  for (let i = period; i <= firstAdxIndex; i++) {
    if (!Number.isNaN(dx[i])) {
      dxSum += dx[i]!;
      count++;
    }
  }
  if (count === 0) return out;
  out[firstAdxIndex] = dxSum / count;
  for (let i = firstAdxIndex + 1; i < n; i++) {
    out[i] = (out[i - 1]! * (period - 1) + dx[i]!) / period;
  }
  return out;
}
