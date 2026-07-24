import { RECENCY_WINDOW_DAYS } from './indicators.ts';
import type { IndicatorReading, IndicatorSignal, Signal } from './types.ts';

export interface DeriveSignalOptions {
  /**
   * Minimum number of BUY readings required to emit BUY. Defaults to 3 —
   * BUY requires unanimity across all three indicators.
   */
  buyConsensus?: number;
  /** Minimum number of SELL readings required to emit SELL. Defaults to 2. */
  sellConsensus?: number;
  /**
   * A crossover older than this many daily bars no longer counts as an active
   * signal. Defaults to {@link RECENCY_WINDOW_DAYS}.
   */
  recencyDays?: number;
}

/**
 * Turn one indicator's crossover facts into a directional signal.
 *
 * This is the deterministic "judgment" layer. The VLM reports what it saw — a
 * clean crossover, its direction, how many bars ago, and whether it met the
 * zone/slope condition. The recency window is applied *here*, in code, so it
 * stays tunable and unit-tested rather than baked into the model's output.
 *
 * A crossover fires only if it is qualified AND recent enough; otherwise NEUTRAL.
 */
export function deriveIndicatorSignal(
  reading: IndicatorReading,
  options: DeriveSignalOptions = {},
): IndicatorSignal {
  const recencyDays = options.recencyDays ?? RECENCY_WINDOW_DAYS;
  if (reading.crossover === 'NONE') return 'NEUTRAL';
  if (!reading.qualified) return 'NEUTRAL';
  if (reading.barsAgo === undefined || reading.barsAgo > recencyDays) return 'NEUTRAL';
  return reading.crossover === 'BULLISH' ? 'BUY' : 'SELL';
}

/** Tally of BUY / SELL signals (NEUTRAL is the remainder). */
export interface SignalTally {
  buys: number;
  sells: number;
  neutrals: number;
}

export function tallySignals(signals: readonly IndicatorSignal[]): SignalTally {
  const tally: SignalTally = { buys: 0, sells: 0, neutrals: 0 };
  for (const signal of signals) {
    if (signal === 'BUY') tally.buys++;
    else if (signal === 'SELL') tally.sells++;
    else tally.neutrals++;
  }
  return tally;
}

/**
 * Combine per-indicator signals into an overall Buy/Sell/Hold recommendation.
 *
 * Policy — asymmetric, risk-averse:
 *   - SELL if at least `sellConsensus` indicators read SELL (default 2).
 *   - BUY  if at least `buyConsensus` indicators read BUY   (default 3 — unanimity).
 *   - HOLD otherwise.
 *
 * SELL is evaluated first, so if the thresholds are ever lowered such that both
 * could match, the protective (exit) signal wins.
 */
export function combineSignals(
  signals: readonly IndicatorSignal[],
  options: DeriveSignalOptions = {},
): Signal {
  const buyConsensus = options.buyConsensus ?? 3;
  const sellConsensus = options.sellConsensus ?? 2;
  const { buys, sells } = tallySignals(signals);

  if (sells >= sellConsensus) return 'SELL';
  if (buys >= buyConsensus) return 'BUY';
  return 'HOLD';
}

/**
 * The full path: crossover facts → per-indicator signals (recency applied) →
 * overall recommendation.
 */
export function deriveSignal(
  readings: readonly IndicatorReading[],
  options: DeriveSignalOptions = {},
): Signal {
  const signals = readings.map((reading) => deriveIndicatorSignal(reading, options));
  return combineSignals(signals, options);
}
