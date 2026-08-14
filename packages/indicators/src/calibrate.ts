import type { IndicatorValues } from './values.ts';

/**
 * Confirm the computed indicator series matches TradingView's rendering by
 * comparing the last-bar values to the legend snapshot we capture alongside the
 * chart. Passing calibration turns "does my math match TradingView's math" from
 * a hope into a checked invariant; and catches data-source mismatches too
 * (wrong prices → wrong SMA → fails here rather than silently mis-grading).
 */
export interface CalibrationField {
  field: string;
  computed: number;
  legend: number;
  diff: number;
  tolerance: number;
  ok: boolean;
}

export interface CalibrationResult {
  ok: boolean;
  fields: CalibrationField[];
}

export interface CalibrationTolerances {
  /** Absolute tolerance for MACD line/signal/histogram (small values). */
  macd?: number;
  /** Absolute tolerance for %K/%D (0–100 scale). */
  stochastic?: number;
  /** Relative tolerance for SMA and close (fraction of the value). */
  priceRelative?: number;
}

const DEFAULTS: Required<CalibrationTolerances> = {
  macd: 0.15,
  stochastic: 3,
  priceRelative: 0.005, // 0.5%
};

export function calibrate(
  computed: IndicatorValues,
  legend: IndicatorValues,
  tolerances: CalibrationTolerances = {},
): CalibrationResult {
  const tol = { ...DEFAULTS, ...tolerances };
  const fields: CalibrationField[] = [];

  const cmp = (field: string, a: number, b: number, tolerance: number) => {
    const diff = Math.abs(a - b);
    fields.push({ field, computed: a, legend: b, diff, tolerance, ok: diff <= tolerance });
  };

  cmp('macd.macd', computed.macd.macd, legend.macd.macd, tol.macd);
  cmp('macd.signal', computed.macd.signal, legend.macd.signal, tol.macd);
  cmp('stochastic.percentK', computed.stochastic.percentK, legend.stochastic.percentK, tol.stochastic);
  cmp('stochastic.percentD', computed.stochastic.percentD, legend.stochastic.percentD, tol.stochastic);
  cmp('sma', computed.sma, legend.sma, Math.abs(legend.sma) * tol.priceRelative);
  cmp('close', computed.close, legend.close, Math.abs(legend.close) * tol.priceRelative);

  return { ok: fields.every((f) => f.ok), fields };
}
