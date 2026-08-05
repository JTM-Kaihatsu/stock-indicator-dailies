/**
 * Live interpretation eval: grade the VLM's chart reading against the calibrated
 * oracle across N charts.
 *
 *   npm run eval -w @stock-indicator-dailies/eval-interpretation -- GEV NVDA AAPL
 *
 * Drives a real browser and makes ONE billed model call per ticker. Tickers are
 * required — there is no default, so a bare run cannot silently bill you.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { runEval } from './src/harness.ts';
import { formatReport } from './src/report.ts';
import { toCsv } from './src/csv.ts';

import { TradingViewChartAgent } from '@stock-indicator-dailies/agent';
import { ClaudeVlmProvider } from '@stock-indicator-dailies/vlm';

const tickers = process.argv.slice(2).map((t) => t.toUpperCase());

if (tickers.length === 0) {
  console.error('usage: npm run eval -w @stock-indicator-dailies/eval-interpretation -- TICKER [TICKER...]');
  console.error('  (each ticker is one live browser capture + one billed model call)');
  process.exit(1);
}

console.error(`\nRunning interpretation eval on ${tickers.length} chart(s): ${tickers.join(', ')}`);
console.error('This drives a real browser and makes billed model calls.\n');

const dir = process.env.INIT_CWD ?? process.cwd();
const imageDir = path.resolve(dir, 'eval-images');
mkdirSync(imageDir, { recursive: true });

const run = await runEval(tickers, {
  agent: new TradingViewChartAgent(),
  provider: new ClaudeVlmProvider(),
}, { imageDir });

console.log(formatReport(run));

const jsonPath = path.resolve(dir, 'eval-interpretation.json');
const csvPath = path.resolve(dir, 'eval-interpretation.csv');
writeFileSync(jsonPath, JSON.stringify(run, null, 2));
writeFileSync(csvPath, toCsv(run));
console.log(`\n  full results -> ${jsonPath}`);
console.log(`  label sheet  -> ${csvPath}  (open in Excel; fill the truth_* columns)\n`);
