import { RECENCY_WINDOW_DAYS } from './indicators.ts';
import type { IndicatorReading, IndicatorSignal, Signal } from './types.ts';

export interface DeriveSignalOptions {
  /** Minimum number of BUY readings required to emit BUY. Defaults to 2. */
  buyConsensus?: number;
  /**
   * Minimum number of SELL readings required to emit SELL. Defaults to 3;
   * SELL requires unanimity across all three indicators.
   */
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
 * This is the deterministic "judgment" layer. The VLM reports what it saw; a
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
 * Policy:
 *   - SELL if at least `sellConsensus` indicators read SELL (default 3; unanimity).
 *   - BUY  if at least `buyConsensus` indicators read BUY   (default 2).
 *   - HOLD otherwise.
 *
 * Backtesting (see evals/backtest) found the previous asymmetric policy
 * (BUY needing unanimity, SELL needing only 2-of-3) exited positions on
 * weak confirmation while requiring near-unanimity to re-enter, chronically
 * underperforming buy-and-hold on trending stocks. Requiring unanimity on
 * the *exit* side instead reduces premature/whipsaw sells, while BUY at
 * 2-of-3 lets the strategy actually participate in trends.
 *
 * SELL is evaluated first, so if the thresholds are ever lowered such that both
 * could match, the protective (exit) signal wins.
 */
export function combineSignals(
  signals: readonly IndicatorSignal[],
  options: DeriveSignalOptions = {},
): Signal {
  const buyConsensus = options.buyConsensus ?? 2;
  const sellConsensus = options.sellConsensus ?? 3;
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

/**
 * Combine a deterministic-path overall signal with a chart/AI-read overall
 * signal into one final recommendation. Not the same operation as
 * {@link combineSignals}: that folds three per-indicator signals into one
 * overall signal; this folds two already-final overall signals (the
 * computed read and the AI read) into one. Asymmetric and risk-averse:
 * either side calling SELL is enough to exit, but BUY needs both to agree;
 * a HOLD from the computed side keeps the result at HOLD even when the AI
 * read is more bullish.
 *
 * `null` means "no read yet" (e.g. a watchlist ticker still pending its
 * first capture); the result is `null` only when the AI side is null, since
 * that's the read that's always present once a capture succeeds at all.
 */
export function resolveDualOverall(detSignal: Signal | null, aiSignal: Signal | null): Signal | null {
  if (aiSignal === null) return null;
  if (detSignal === null) return aiSignal;
  if (detSignal === 'SELL' || aiSignal === 'SELL') return 'SELL';
  if (detSignal === 'HOLD') return 'HOLD';
  if (detSignal === 'BUY' && aiSignal === 'BUY') return 'BUY';
  return 'HOLD';
}
