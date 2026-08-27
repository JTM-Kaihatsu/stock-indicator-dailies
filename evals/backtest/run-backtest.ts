/**
 * Walk-forward backtest: replay the deterministic BUY/SELL/HOLD policy over
 * real history for one or more tickers and report whether following it would
 * have beaten just buying and holding.
 *
 *   npm run backtest -w @stock-indicator-dailies/eval-backtest
 *   npm run backtest -w @stock-indicator-dailies/eval-backtest -- NVDA AAPL GOOG
 *   npm run backtest -w @stock-indicator-dailies/eval-backtest -- --range=5y NVDA
 *   npm run backtest -w @stock-indicator-dailies/eval-backtest -- --buy-consensus=2 NVDA
 *   npm run backtest -w @stock-indicator-dailies/eval-backtest -- --min-holding-days=10 --atr-multiplier=2 NVDA
 *
 * No model calls, no chart capture; pure history replay against Yahoo OHLC
 * data, using the exact `computeReadings` + `deriveSignal` the app ships.
 */
import { yahooDataSource } from '@stock-indicator-dailies/indicators';

import { runBacktest, type BacktestOptions, type BacktestResult } from './src/simulate.ts';

const DEFAULT_TICKERS = ['NVDA', 'AAPL', 'GOOG', 'AVGO', 'INTC', 'NFLX', 'GEV', 'CEG', 'VST'];

const FLAG_HANDLERS: Record<string, (options: BacktestOptions, value: string) => void> = {
  'buy-consensus': (o, v) => (o.buyConsensus = Number(v)),
  'sell-consensus': (o, v) => (o.sellConsensus = Number(v)),
  recency: (o, v) => (o.recencyDays = Number(v)),
  'persistence-bars': (o, v) => (o.persistenceBars = Number(v)),
  'min-holding-days': (o, v) => (o.minHoldingDays = Number(v)),
  'atr-multiplier': (o, v) => (o.atrMultiplier = Number(v)),
  'atr-period': (o, v) => (o.atrPeriod = Number(v)),
  'adx-threshold': (o, v) => (o.adxThreshold = Number(v)),
  'adx-period': (o, v) => (o.adxPeriod = Number(v)),
};

const args = process.argv.slice(2);
let range = '2y';
const options: BacktestOptions = {};
const tickers: string[] = [];
for (const arg of args) {
  const rangeMatch = /^--range=(.+)$/.exec(arg);
  const flagMatch = /^--([a-z-]+)=(.+)$/.exec(arg);
  if (rangeMatch) range = rangeMatch[1]!;
  else if (flagMatch && FLAG_HANDLERS[flagMatch[1]!]) FLAG_HANDLERS[flagMatch[1]!]!(options, flagMatch[2]!);
  else tickers.push(arg.toUpperCase());
}
if (tickers.length === 0) tickers.push(...DEFAULT_TICKERS);

const pct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`.padStart(7);
const money = (n: number) => `$${n.toFixed(2)}`;

const policyDesc =
  `buyConsensus=${options.buyConsensus ?? 2} sellConsensus=${options.sellConsensus ?? 3} ` +
  `recencyDays=${options.recencyDays ?? 3}`;
const leverParts: string[] = [];
if (options.persistenceBars !== undefined) leverParts.push(`persistenceBars=${options.persistenceBars}`);
if (options.minHoldingDays !== undefined) leverParts.push(`minHoldingDays=${options.minHoldingDays}`);
if (options.atrMultiplier !== undefined) leverParts.push(`atrMultiplier=${options.atrMultiplier} (period ${options.atrPeriod ?? 14})`);
if (options.adxThreshold !== undefined) leverParts.push(`adxThreshold=${options.adxThreshold} (period ${options.adxPeriod ?? 14})`);

console.log(`\nWalk-forward backtest; range ${range}, ${tickers.length} ticker(s)`);
console.log(`policy: ${policyDesc} (defaults shown where not overridden)`);
console.log(`execution filters: ${leverParts.length > 0 ? leverParts.join(', ') : '(none; pure vote-based signal)'}\n`);

const results: BacktestResult[] = [];
for (const ticker of tickers) {
  try {
    const { bars } = await yahooDataSource.fetchDailyBars(ticker, range);
    const result = runBacktest(ticker, bars, options);
    results.push(result);

    console.log(`── ${ticker} ${'─'.repeat(50 - ticker.length)}`);
    console.log(`  ${result.startDate} → ${result.endDate} (${result.barsUsed} bars)`);
    for (const t of result.trades) {
      console.log(`  ${t.date}  ${t.type.padEnd(4)} @ ${money(t.price)}  → portfolio ${money(t.portfolioValue)}`);
    }
    if (result.trades.length === 0) console.log('  (no trades; signal never left HOLD)');
    if (result.stillHolding) console.log('  (still holding at end; marked to market at final close)');
    console.log(
      `  strategy ${pct(result.strategyReturnPct)}   buy-and-hold ${pct(result.buyAndHoldReturnPct)}   ` +
        `${result.strategyReturnPct > result.buyAndHoldReturnPct ? 'beat' : 'lagged'} buy-and-hold\n`,
    );
  } catch (err) {
    console.log(`── ${ticker}: FAILED; ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

if (results.length > 0) {
  const avgStrategy = results.reduce((s, r) => s + r.strategyReturnPct, 0) / results.length;
  const avgBuyHold = results.reduce((s, r) => s + r.buyAndHoldReturnPct, 0) / results.length;
  const beatCount = results.filter((r) => r.strategyReturnPct > r.buyAndHoldReturnPct).length;
  const totalTrades = results.reduce((s, r) => s + r.trades.length, 0);
  console.log('─'.repeat(60));
  console.log(`  average strategy return   ${pct(avgStrategy)}`);
  console.log(`  average buy-and-hold      ${pct(avgBuyHold)}`);
  console.log(`  beat buy-and-hold on      ${beatCount}/${results.length} tickers`);
  console.log(`  total trades              ${totalTrades}`);
  console.log();
}
