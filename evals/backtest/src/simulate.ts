import { deriveSignal, type DeriveSignalOptions, type Signal } from '@stock-indicator-dailies/shared';
import { computeReadings, type Bar } from '@stock-indicator-dailies/indicators';

/**
 * Walk-forward backtest of the deterministic BUY/SELL/HOLD policy.
 *
 * Split into two layers so the portfolio bookkeeping is testable without
 * needing to engineer real indicator crossovers by hand:
 *   - `signalsForBars` recomputes the signal one bar at a time from only the
 *     data that would have been visible *as of that day* (`bars.slice(0, i +
 *     1)`) — never peeking ahead. Uses `computeReadings` + `deriveSignal`
 *     unmodified, so it's testing the exact policy the app ships, not a
 *     reimplementation that could drift from it.
 *   - `applyStrategy` takes any signal sequence and simulates trading it.
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

export interface BacktestOptions extends DeriveSignalOptions {
  startingCapital?: number;
}

/**
 * One signal per bar from index 1 onward (index 0 has no prior bar to cross
 * against). `signals[i]` corresponds to `bars[i + 1]`.
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
 * Simulates an all-in/all-out portfolio (buy with all available cash on
 * BUY, liquidate fully on SELL) against a sequence of signals — one per bar
 * from `bars[1]` onward, matching `signalsForBars`'s output shape. Returns
 * compound across trades this way, so `strategyReturnPct` is directly
 * comparable to `buyAndHoldReturnPct` regardless of the stock's price level.
 */
export function applyStrategy(
  ticker: string,
  bars: readonly Bar[],
  signals: readonly Signal[],
  startingCapital = 10_000,
): BacktestResult {
  if (bars.length < 2) {
    throw new Error(`need at least 2 bars to backtest ${ticker}, got ${bars.length}`);
  }
  if (signals.length !== bars.length - 1) {
    throw new Error(`expected ${bars.length - 1} signals (one per bar from index 1), got ${signals.length}`);
  }

  let cash = startingCapital;
  let shares = 0;
  let holding = false;
  const trades: Trade[] = [];

  for (let i = 0; i < signals.length; i++) {
    const bar = bars[i + 1]!;
    const signal = signals[i]!;

    if (signal === 'BUY' && !holding) {
      shares = cash / bar.close;
      cash = 0;
      holding = true;
      trades.push({ type: 'BUY', date: bar.date, price: bar.close, portfolioValue: shares * bar.close });
    } else if (signal === 'SELL' && holding) {
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
  return applyStrategy(ticker, bars, signals, options.startingCapital);
}
