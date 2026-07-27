/**
 * Live calibration: prove the TS indicator math matches TradingView.
 *
 *   node evals/interpretation/calibrate-live.ts GEV
 *
 * Fetches Yahoo OHLC, reads TradingView's own legend values for the same ticker,
 * and compares. If they agree, the oracle's math is confirmed against the exact
 * chart the model sees. Also prints the computed ground-truth facts.
 */
import { chromium } from 'playwright';

import { resolveProfileDir, TRADINGVIEW } from '@stock-indicator-dailies/agent';

import { yahooDataSource } from './src/ohlc.ts';
import { computeLastBar, computeOracleReadings } from './src/event-oracle.ts';
import { calibrate } from './src/calibrate.ts';
import type { IndicatorValues } from './src/oracle.ts';

const ticker = (process.argv[2] ?? 'GEV').toUpperCase();

// --- 1. Yahoo OHLC + computed indicators ---
const bars = await yahooDataSource.fetchDailyBars(ticker, '1y');
console.log(`Yahoo: ${bars.length} bars, last ${bars.at(-1)!.date} close ${bars.at(-1)!.close}`);
const computed = computeLastBar(bars);

// --- 2. TradingView legend values for the same ticker ---
const context = await chromium.launchPersistentContext(resolveProfileDir(), { headless: true });
const page = context.pages()[0] ?? (await context.newPage());
await page.goto(TRADINGVIEW.chartUrl(ticker), { waitUntil: 'domcontentloaded', timeout: 60_000 });
await page.waitForTimeout(9000);

const legend = await page.evaluate(() => {
  // TradingView renders negatives with the Unicode minus U+2212; normalize it.
  const parse = (s: string) => Number(s.replace(/−/g, '-').replace(/[^0-9.-]/g, ''));
  const byTitle: Record<string, number> = {};
  for (const el of Array.from(document.querySelectorAll('[class*="valueValue"]'))) {
    const title = el.getAttribute('title');
    const num = parse(el.textContent ?? '');
    if (title && Number.isFinite(num)) byTitle[title] = num;
  }
  const header = Array.from(document.querySelectorAll('div,span'))
    .map((el) => (el.textContent ?? '').replace(/\s+/g, ''))
    .find((t) => /^O[\d.,]+H[\d.,]+L[\d.,]+C/.test(t));
  const close = header ? Number(/C(\d+\.\d+)/.exec(header)?.[1]) : NaN;
  return { byTitle, close };
});
await context.close();

const tvValues: IndicatorValues = {
  macd: {
    macd: legend.byTitle['MACD']!,
    signal: legend.byTitle['Signal line']!,
    histogram: legend.byTitle['Histogram']!,
  },
  stochastic: { percentK: legend.byTitle['%K']!, percentD: legend.byTitle['%D']! },
  sma: legend.byTitle['MA']!,
  close: legend.close,
};

// --- 3. Calibrate ---
const result = calibrate(computed, tvValues);
console.log(`\ncalibration: ${result.ok ? '✅ PASS' : '❌ FAIL'}`);
for (const f of result.fields) {
  console.log(
    `  ${f.ok ? '✓' : '✗'} ${f.field.padEnd(20)} computed ${f.computed.toFixed(3).padStart(10)}  ` +
      `tv ${f.legend.toFixed(3).padStart(10)}  Δ ${f.diff.toFixed(3)} (tol ${f.tolerance.toFixed(3)})`,
  );
}

// --- 4. Ground-truth facts ---
console.log('\noracle facts:');
for (const r of computeOracleReadings(bars)) {
  const fact = r.crossover === 'NONE' ? 'no crossover' : `${r.crossover} ${r.barsAgo}d ago, qualified=${r.qualified}`;
  console.log(`  ${r.indicator.padEnd(16)} ${fact}`);
}
