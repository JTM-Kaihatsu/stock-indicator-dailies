/**
 * Run one Daily end to end.
 *
 *   npm run daily -w @stock-indicator-dailies/daily -- NVDA
 *
 * Drives a real browser and makes a live (billed) model call.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';

import { TradingViewChartAgent } from '@stock-indicator-dailies/agent';
import { ClaudeVlmProvider } from '@stock-indicator-dailies/vlm';

import { runDaily } from './run-daily.ts';

const ticker = (process.argv[2] ?? 'NVDA').toUpperCase();
const saveTo = process.argv[3];

const result = await runDaily({
  ticker,
  agent: new TradingViewChartAgent(),
  provider: new ClaudeVlmProvider(),
});

if (!result.ok) {
  console.error(`\n❌ ${ticker}: failed during ${result.stage} (${result.reason})`);
  for (const e of result.errors) console.error(`   ${e}`);
  console.error(`   capture ${(result.timings.captureMs / 1000).toFixed(1)}s`);
  process.exit(1);
}

const { report } = result;
const { verdict, timings } = report;

console.log(`\n${'='.repeat(52)}`);
console.log(`  ${verdict.ticker}   →   ${verdict.signal}`);
console.log(`${'='.repeat(52)}`);
for (const r of verdict.readings) {
  console.log(`  ${r.indicator.padEnd(16)} ${r.signal.padEnd(8)} ${r.rationale ?? ''}`);
}
if (verdict.visibleRange) console.log(`\n  chart window: ${verdict.visibleRange}`);
console.log(
  `  time-to-signal: ${(timings.totalMs / 1000).toFixed(1)}s ` +
    `(capture ${(timings.captureMs / 1000).toFixed(1)}s + analyze ${(timings.analyzeMs / 1000).toFixed(1)}s)` +
    `${timings.withinTarget ? ' ✅' : ' ⚠️ over 15s target'}`,
);
for (const w of report.warnings) console.log(`  ⚠️  ${w}`);

if (saveTo) {
  // `npm run -w <pkg>` sets cwd to the package directory, so a relative path
  // would land inside packages/daily. INIT_CWD is where the user actually ran it.
  const target = path.resolve(process.env.INIT_CWD ?? process.cwd(), saveTo);
  writeFileSync(target, Buffer.from(report.image.base64, 'base64'));
  console.log(`  chart saved -> ${target}`);
}
console.log();
