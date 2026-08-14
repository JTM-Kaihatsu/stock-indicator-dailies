import { deriveSignal, type DeriveSignalOptions, type Signal } from '@stock-indicator-dailies/shared';
import { computeReadings, type Bar } from '@stock-indicator-dailies/indicators';

import { adx, atr } from './volatility.ts';

/**
 * Walk-forward backtest of the deterministic BUY/SELL/HOLD policy, with
 * optional strategy-execution filters layered on top of the raw per-bar
 * signal (see `BacktestOptions`).
 *
 * Split into two layers so the portfolio bookkeeping and execution filters
 * are testable without needing to engineer real indicator crossovers by
 * hand:
 *   - `signalsForBars` recomputes the raw signal one bar at a time from only
 *     the data that would have been visible *as of that day*
 *     (`bars.slice(0, i + 1)`); never peeking ahead. Uses `computeReadings`
 *     + `deriveSignal` unmodified, so it's testing the exact "what does the
 *     chart say today" policy the app ships, not a reimplementation.
 *   - `applyStrategy` takes any raw signal sequence and simulates trading
 *     it, applying the execution-layer filters (persistence, minimum
 *     holding period, ATR noise reduction, ADX trend gate) before acting.
 *
 * `runBacktest` wires the two together for real use; tests exercise
 * `applyStrategy` directly with synthetic signal sequences.
 */

export interface Trade {
  type: 'BUY' | 'SELL';
  date: string;
  price: number;
  /** Portfolio value immediately after this trade executes. */
  portfolioValue: number;
}

export interface BacktestResult {
  ticker: string;
  startDate: string;
  endDate: string;
  barsUsed: number;
  trades: Trade[];
  startingCapital: number;
  finalValue: number;
  strategyReturnPct: number;
  buyAndHoldReturnPct: number;
  stillHolding: boolean;
}

export interface StrategyOptions {
  startingCapital?: number;
  /**
   * Require the same raw non-HOLD signal to repeat this many consecutive
   * bars before acting on it; filters single-bar noise flips. Default 1
   * (act on the first occurrence, i.e. no persistence filter).
   */
  persistenceBars?: number;
  /**
   * Minimum bars a position must be held before a SELL can execute, counted
   * from the BUY bar. Default 0 (no minimum).
   */
  minHoldingDays?: number;
  /**
   * ATR noise-reduction filter: while holding, suppress a SELL unless price
   * has fallen at least this many ATR multiples below the highest close
   * seen since entry. `undefined` (default) disables the filter.
   */
  atrMultiplier?: number;
  /** ATR lookback period. Default 14 (Wilder's original). */
  atrPeriod?: number;
  /**
   * ADX trend-strength gate: suppress any BUY/SELL unless ADX is at or above
   * this threshold (commonly 20-25 marks a trending market). `undefined`
   * (default) disables the filter; a boolean "on/off" toggle in a caller's
   * UI can just set/unset this to a sensible default like 25.
   */
  adxThreshold?: number;
  /** ADX lookback period. Default 14. */
  adxPeriod?: number;
}

export interface BacktestOptions extends DeriveSignalOptions, StrategyOptions {}

/**
 * One raw signal per bar from index 1 onward (index 0 has no prior bar to
 * cross against). `signals[i]` corresponds to `bars[i + 1]`.
 */
export function signalsForBars(bars: readonly Bar[], options: DeriveSignalOptions = {}): Signal[] {
  const signals: Signal[] = [];
  for (let i = 1; i < bars.length; i++) {
    const window = bars.slice(0, i + 1);
    signals.push(deriveSignal(computeReadings(window), options));
  }
  return signals;
}

/**
 * Simulates an all-in/all-out portfolio (buy with all available cash on a
 * confirmed BUY, liquidate fully on a confirmed SELL) against a sequence of
 * raw signals; one per bar from `bars[1]` onward, matching
 * `signalsForBars`'s output shape. Returns compound across trades this way,
 * so `strategyReturnPct` is directly comparable to `buyAndHoldReturnPct`
 * regardless of the stock's price level.
 *
 * The execution filters in `options` gate whether a raw signal is actually
 * *acted on*; they never change the raw signal itself, only whether this
 * bar's occurrence of it triggers a trade.
 */
export function applyStrategy(
  ticker: string,
  bars: readonly Bar[],
  signals: readonly Signal[],
  options: StrategyOptions = {},
): BacktestResult {
  if (bars.length < 2) {
    throw new Error(`need at least 2 bars to backtest ${ticker}, got ${bars.length}`);
  }
  if (signals.length !== bars.length - 1) {
    throw new Error(`expected ${bars.length - 1} signals (one per bar from index 1), got ${signals.length}`);
  }

  const startingCapital = options.startingCapital ?? 10_000;
  const persistenceBars = Math.max(1, options.persistenceBars ?? 1);
  const minHoldingDays = options.minHoldingDays ?? 0;
  const { atrMultiplier, adxThreshold } = options;
  const atrSeries = atrMultiplier !== undefined ? atr(bars, options.atrPeriod ?? 14) : undefined;
  const adxSeries = adxThreshold !== undefined ? adx(bars, options.adxPeriod ?? 14) : undefined;

  let cash = startingCapital;
  let shares = 0;
  let holding = false;
  let entryIndex = -1;
  let peakSinceEntry = -Infinity;
  const trades: Trade[] = [];

  // Consecutive-repeat streak of the raw signal, for the persistence filter.
  let streakSignal: Signal | null = null;
  let streakLen = 0;

  for (let i = 0; i < signals.length; i++) {
    const barIndex = i + 1;
    const bar = bars[barIndex]!;
    const rawSignal = signals[i]!;

    streakLen = rawSignal === streakSignal ? streakLen + 1 : 1;
    streakSignal = rawSignal;

    if (holding) peakSinceEntry = Math.max(peakSinceEntry, bar.close);

    let action: Signal = rawSignal;
    if (action !== 'HOLD' && adxThreshold !== undefined) {
      const adxVal = adxSeries![barIndex]!;
      if (Number.isNaN(adxVal) || adxVal < adxThreshold) action = 'HOLD';
    }
    if (action !== 'HOLD' && streakLen < persistenceBars) action = 'HOLD';

    if (action === 'BUY' && !holding) {
      shares = cash / bar.close;
      cash = 0;
      holding = true;
      entryIndex = barIndex;
      peakSinceEntry = bar.close;
      trades.push({ type: 'BUY', date: bar.date, price: bar.close, portfolioValue: shares * bar.close });
    } else if (action === 'SELL' && holding) {
      if (barIndex - entryIndex < minHoldingDays) continue;
      if (atrMultiplier !== undefined) {
        // Yesterday's ATR, not today's; today's true range would include
        // the very drop being evaluated, self-inflating the threshold on
        // exactly the bar a real sharp move happens.
        const atrVal = atrSeries![barIndex - 1]!;
        if (Number.isNaN(atrVal) || peakSinceEntry - bar.close < atrMultiplier * atrVal) continue;
      }
      cash = shares * bar.close;
      shares = 0;
      holding = false;
      trades.push({ type: 'SELL', date: bar.date, price: bar.close, portfolioValue: cash });
    }
  }

  const lastClose = bars[bars.length - 1]!.close;
  const finalValue = holding ? shares * lastClose : cash;

  const firstClose = bars[0]!.close;
  const buyAndHoldReturnPct = ((lastClose - firstClose) / firstClose) * 100;
  const strategyReturnPct = ((finalValue - startingCapital) / startingCapital) * 100;

  return {
    ticker,
    startDate: bars[0]!.date,
    endDate: bars[bars.length - 1]!.date,
    barsUsed: bars.length,
    trades,
    startingCapital,
    finalValue,
    strategyReturnPct,
    buyAndHoldReturnPct,
    stillHolding: holding,
  };
}

export function runBacktest(ticker: string, bars: readonly Bar[], options: BacktestOptions = {}): BacktestResult {
  const signals = signalsForBars(bars, options);
  return applyStrategy(ticker, bars, signals, options);
}
