/**
 * Run one Daily end to end.
 *
 *   npm run daily -w @stock-indicator-dailies/daily -- NVDA
 *
 * Drives a real browser and makes a live (billed) model call.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';

import { deriveIndicatorSignal } from '@stock-indicator-dailies/shared';
import { TradingViewChartAgent } from '@stock-indicator-dailies/agent';
import { ClaudeVlmProvider } from '@stock-indicator-dailies/vlm';

import { runDaily } from './run-daily.ts';
import { renderDailyReportHtml } from './report-html.ts';

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
const { verdict, deterministic, timings } = report;
const headline = deterministic ? deterministic.signal : `— (${verdict.signal} from AI only)`;

console.log(`\n${'='.repeat(56)}`);
console.log(`  ${verdict.ticker}   →   ${headline}     (AI read: ${verdict.signal})`);
console.log(`${'='.repeat(56)}`);
const detByKey = new Map((deterministic?.readings ?? []).map((r) => [r.indicator, r]));
for (const r of verdict.readings) {
  const aiSig = deriveIndicatorSignal(r);
  const det = detByKey.get(r.indicator);
  const detSig = det ? deriveIndicatorSignal(det) : '—';
  const label = (rr: typeof r) =>
    rr.crossover === 'NONE' ? 'none' : `${rr.crossover.toLowerCase()} ${rr.barsAgo}d${rr.qualified ? '' : ' unq'}`;
  const mark = det ? (detSig === aiSig ? '' : '  ⚠ differ') : '';
  console.log(
    `  ${r.indicator.padEnd(16)} computed ${String(detSig).padEnd(8)}${det ? `(${label(det)})`.padEnd(18) : ''.padEnd(18)}` +
      `AI ${aiSig.padEnd(8)}(${label(r)})${mark}`,
  );
}
console.log(
  `\n  time-to-signal: ${(timings.totalMs / 1000).toFixed(1)}s ` +
    `(capture ${(timings.captureMs / 1000).toFixed(1)}s + analyze ${(timings.analyzeMs / 1000).toFixed(1)}s)` +
    `${timings.withinTarget ? ' ✅' : ' ⚠️ over 15s'}  · deterministic ${(timings.deterministicMs / 1000).toFixed(1)}s`,
);
for (const w of report.warnings) console.log(`  ⚠️  ${w}`);

const outBase = path.resolve(process.env.INIT_CWD ?? process.cwd(), saveTo ?? `report-${ticker.toLowerCase()}.html`);
writeFileSync(outBase, renderDailyReportHtml(report));
console.log(`\n  report -> ${outBase}`);

// Save the source chart alongside the report. The capture is scoped to the chart
// container (no watchlist / account chrome), so it carries no account PII — this
// is the exact image the reads were derived from, kept as evidence.
const imgPath = outBase.replace(/\.html?$/i, '') + '.png';
writeFileSync(imgPath, Buffer.from(report.image.base64, 'base64'));
console.log(`  chart  -> ${imgPath}`);
console.log();
