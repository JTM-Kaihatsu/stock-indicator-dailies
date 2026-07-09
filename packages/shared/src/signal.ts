import type { IndicatorReading, IndicatorSignal, Signal } from './types.ts';

export interface DeriveSignalOptions {
  /**
   * Minimum number of aligned indicators required to emit a directional signal.
   * Defaults to 2 ("majority"). Set to the indicator count (3) for unanimity,
   * or 1 for a looser policy.
   */
  minConsensus?: number;
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
 * Policy — "confluence without contradiction":
 *   - BUY  if at least `minConsensus` indicators read BUY and none read SELL.
 *   - SELL if at least `minConsensus` indicators read SELL and none read BUY.
 *   - HOLD otherwise (conflicting, insufficient, or all-neutral readings).
 *
 * Any contradiction (at least one BUY *and* at least one SELL) resolves to HOLD:
 * the conservative default for a tool that explicitly does not give financial
 * advice. The threshold is configurable via {@link DeriveSignalOptions.minConsensus}.
 */
export function deriveSignal(
  readings: readonly IndicatorReading[],
  options: DeriveSignalOptions = {},
): Signal {
  const minConsensus = options.minConsensus ?? 2;
  const { buys, sells } = tallyReadings(readings);

  if (buys >= minConsensus && sells === 0) return 'BUY';
  if (sells >= minConsensus && buys === 0) return 'SELL';
  return 'HOLD';
}

/** Convenience alias for readability at call sites that pass raw signals. */
export function readingsFromSignals(
  entries: ReadonlyArray<[IndicatorReading['indicator'], IndicatorSignal]>,
): IndicatorReading[] {
  return entries.map(([indicator, signal]) => ({ indicator, signal }));
}
