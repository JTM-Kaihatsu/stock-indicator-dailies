import type { IndicatorReading, IndicatorSignal, Signal } from './types.ts';

export interface DeriveSignalOptions {
  /**
   * Minimum number of BUY readings required to emit BUY. Defaults to 3 —
   * BUY requires unanimity across all three indicators.
   */
  buyConsensus?: number;
  /**
   * Minimum number of SELL readings required to emit SELL. Defaults to 2.
   */
  sellConsensus?: number;
}

/** Tally of BUY / SELL readings (NEUTRAL is implied by the remainder). */
export interface SignalTally {
  buys: number;
  sells: number;
  neutrals: number;
}

/** Count how many readings fall into each directional bucket. */
export function tallyReadings(readings: readonly IndicatorReading[]): SignalTally {
  const tally: SignalTally = { buys: 0, sells: 0, neutrals: 0 };
  for (const { signal } of readings) {
    if (signal === 'BUY') tally.buys++;
    else if (signal === 'SELL') tally.sells++;
    else tally.neutrals++;
  }
  return tally;
}

/**
 * Combine per-indicator readings into an overall Buy/Sell/Hold recommendation.
 *
 * Policy — asymmetric, risk-averse:
 *   - SELL if at least `sellConsensus` indicators read SELL (default 2).
 *   - BUY  if at least `buyConsensus` indicators read BUY   (default 3 — unanimity).
 *   - HOLD otherwise.
 *
 * The bar to enter (BUY) is deliberately higher than the bar to step aside
 * (SELL). SELL is evaluated first, so if thresholds are ever lowered to a point
 * where both could match, the protective (exit) signal takes precedence.
 */
export function deriveSignal(
  readings: readonly IndicatorReading[],
  options: DeriveSignalOptions = {},
): Signal {
  const buyConsensus = options.buyConsensus ?? 3;
  const sellConsensus = options.sellConsensus ?? 2;
  const { buys, sells } = tallyReadings(readings);

  if (sells >= sellConsensus) return 'SELL';
  if (buys >= buyConsensus) return 'BUY';
  return 'HOLD';
}

/** Convenience alias for readability at call sites that pass raw signals. */
export function readingsFromSignals(
  entries: ReadonlyArray<[IndicatorReading['indicator'], IndicatorSignal]>,
): IndicatorReading[] {
  return entries.map(([indicator, signal]) => ({ indicator, signal }));
}
