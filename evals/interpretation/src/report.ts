import type { AgreementRates } from './fact-score.ts';
import type { ChartEvalResult, EvalRun } from './harness.ts';

/** Render an {@link EvalRun} as a plain-text report for the terminal. */
const pct = (n: number) => `${(n * 100).toFixed(0)}%`;
const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

function chartLine(r: ChartEvalResult): string {
  if (!r.ok) return `  ${r.ticker.padEnd(6)} ❌ ${r.error}`;
  const comparisons = r.comparisons ?? [];
  const agree = comparisons.filter((c) => c.directionMatch).length;
  const barsAgo = comparisons
    .filter((c) => c.bothCrossed)
    .map((c) => `${c.indicator}:Δ${c.barsAgoGap}`)
    .join(' ');
  return (
    `  ${r.ticker.padEnd(6)} dir ${agree}/${comparisons.length}  ${barsAgo.padEnd(40)}` +
    `${secs(r.totalMs)}${r.withinTarget ? ' ✅' : ' ⚠️'}`
  );
}

function ratesLine(label: string, x: AgreementRates): string {
  return (
    `  ${label.padEnd(16)} direction ${pct(x.directionAgreement).padStart(4)}  ` +
    `signal ${pct(x.signalAgreement).padStart(4)}  ` +
    `barsAgo mean ${x.barsAgo.mean.toFixed(1)} (med ${x.barsAgo.median}, max ${x.barsAgo.max}, n=${x.barsAgo.n})  ` +
    `qual ${pct(x.qualifiedAgreement).padStart(4)}`
  );
}

export function formatReport(run: EvalRun): string {
  const lines: string[] = [];
  lines.push('='.repeat(72));
  lines.push('  interpretation eval — VLM read vs. fetched read (agreement, not accuracy)');
  lines.push('='.repeat(72));
  for (const r of run.results) lines.push(chartLine(r));

  lines.push('');
  lines.push('  agreement (label ground truth manually in the CSV)');
  lines.push(ratesLine('  overall', run.summary));
  for (const key of ['macd', 'slowStochastic', 'sma'] as const) {
    lines.push(ratesLine(`    ${key}`, run.summary.perIndicator[key]));
  }
  lines.push('');
  lines.push(
    `  time-to-signal: median ${secs(run.timing.medianTotalMs)}, max ${secs(run.timing.maxTotalMs)}  ` +
      `· within 15s target: ${run.timing.withinTarget}/${run.results.filter((r) => r.ok).length}`,
  );
  return lines.join('\n');
}
