/**
 * Score both reads against the hand-labeled ground truth.
 *
 *   npm run score-truth -w @stock-indicator-dailies/eval-interpretation
 *   npm run score-truth -w @stock-indicator-dailies/eval-interpretation -- some-other.csv
 *
 * Reads the ground-truth CSV (default eval-interpretation-w-ground-truth.csv),
 * builds an IndicatorReading for the vlm / fetched / truth columns of each
 * labeled row, and reports how well the VLM read and the fetched read each match
 * the truth — direction, derived signal, qualified, and barsAgo error. Rows with
 * no truth label (e.g. the failed META capture) are skipped. No model calls.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  deriveSignal,
  type CrossoverDirection,
  type IndicatorKey,
  type IndicatorReading,
  type Signal,
} from '@stock-indicator-dailies/shared';

import { compareReadings, summarize } from './src/fact-score.ts';

// --- CSV parsing (handles quoted fields with commas/quotes) ------------------
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch !== '\r') field += ch;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

const file = path.resolve(
  process.env.INIT_CWD ?? process.cwd(),
  process.argv[2] ?? 'eval-interpretation-w-ground-truth.csv',
);
const rows = parseCsv(readFileSync(file, 'utf8'));
const header = rows[0]!;
const col = (name: string) => header.indexOf(name);

const bool = (s: string) => /^true$/i.test(s.trim());
function makeReading(indicator: IndicatorKey, crossover: string, barsAgo: string, qualified: string): IndicatorReading {
  const dir = crossover.trim().toUpperCase() as CrossoverDirection;
  const n = barsAgo.trim() === '' ? undefined : Number(barsAgo);
  return {
    indicator,
    crossover: dir,
    qualified: bool(qualified),
    ...(dir !== 'NONE' && n !== undefined && Number.isFinite(n) ? { barsAgo: n } : {}),
  };
}

// --- Build per-ticker readings for the labeled rows --------------------------
interface TickerReadings {
  vlm: IndicatorReading[];
  fetched: IndicatorReading[];
  truth: IndicatorReading[];
}
const byTicker = new Map<string, TickerReadings>();

for (const r of rows.slice(1)) {
  const ticker = r[col('ticker')]?.trim();
  const indicator = r[col('indicator')]?.trim() as IndicatorKey;
  const truthDir = r[col('truth_crossover')]?.trim();
  if (!ticker || !indicator || !truthDir) continue; // skip failed / unlabeled rows

  const entry = byTicker.get(ticker) ?? { vlm: [], fetched: [], truth: [] };
  entry.vlm.push(makeReading(indicator, r[col('vlm_crossover')]!, r[col('vlm_barsAgo')]!, r[col('vlm_qualified')]!));
  entry.fetched.push(makeReading(indicator, r[col('fetched_crossover')]!, r[col('fetched_barsAgo')]!, r[col('fetched_qualified')]!));
  entry.truth.push(makeReading(indicator, truthDir, r[col('truth_barsAgo')]!, r[col('truth_qualified')]!));
  byTicker.set(ticker, entry);
}

// --- Compare each read against truth -----------------------------------------
const vlmVsTruth = [];
const fetchedVsTruth = [];
for (const [ticker, r] of byTicker) {
  vlmVsTruth.push(...compareReadings(r.vlm, r.truth, {}, ticker));
  fetchedVsTruth.push(...compareReadings(r.fetched, r.truth, {}, ticker));
}
const vlm = summarize(vlmVsTruth);
const fetched = summarize(fetchedVsTruth);

// --- Overall suggestion per ticker -------------------------------------------
interface TickerSuggestion {
  ticker: string;
  vlm: Signal;
  fetched: Signal;
  truth: Signal;
}
const suggestions: TickerSuggestion[] = [];
for (const [ticker, r] of byTicker) {
  suggestions.push({
    ticker,
    vlm: deriveSignal(r.vlm),
    fetched: deriveSignal(r.fetched),
    truth: deriveSignal(r.truth),
  });
}
const vlmSuggestionAcc = suggestions.filter((s) => s.vlm === s.truth).length / suggestions.length;
const fetchedSuggestionAcc = suggestions.filter((s) => s.fetched === s.truth).length / suggestions.length;

// --- Report ------------------------------------------------------------------
const pct = (n: number) => `${(n * 100).toFixed(0)}%`.padStart(5);
const mae = (n: number) => `${n.toFixed(2)}`.padStart(5);

console.log(`\nScoring against ground truth: ${byTicker.size} tickers, ${vlm.comparisons} indicator rows`);
console.log(`(source: ${path.basename(file)}; unlabeled/failed rows excluded)\n`);
console.log('                        VLM      Fetched   (vs. truth)');
const line = (label: string, v: string, f: string) => console.log(`  ${label.padEnd(20)} ${v}    ${f}`);
line('direction acc', pct(vlm.directionAgreement), pct(fetched.directionAgreement));
line('signal acc', pct(vlm.signalAgreement), pct(fetched.signalAgreement));
line('qualified acc', pct(vlm.qualifiedAgreement), pct(fetched.qualifiedAgreement));
line('barsAgo MAE', mae(vlm.barsAgo.mean), mae(fetched.barsAgo.mean));
line('suggestion acc', pct(vlmSuggestionAcc), pct(fetchedSuggestionAcc));

console.log('\nper-indicator direction / signal accuracy (VLM | Fetched):');
for (const key of ['macd', 'slowStochastic', 'sma'] as const) {
  const v = vlm.perIndicator[key];
  const f = fetched.perIndicator[key];
  console.log(
    `  ${key.padEnd(16)} dir ${pct(v.directionAgreement)}|${pct(f.directionAgreement)}   ` +
      `sig ${pct(v.signalAgreement)}|${pct(f.signalAgreement)}   ` +
      `barsAgo MAE ${mae(v.barsAgo.mean)}|${mae(f.barsAgo.mean)}`,
  );
}

console.log('\noverall suggestion per ticker:');
console.log(`  ${'ticker'.padEnd(8)} VLM        Fetched    Truth`);
for (const s of suggestions) {
  const mark = (v: Signal) => v === s.truth ? v.padEnd(10) : `${v} ✗`.padEnd(10);
  console.log(`  ${s.ticker.padEnd(8)} ${mark(s.vlm)} ${mark(s.fetched)} ${s.truth}`);
}

// Where each read's derived SIGNAL disagrees with truth (candidate vs truth).
const misses = (comps: typeof vlmVsTruth) =>
  comps.filter((c) => !c.signalMatch).map((c) => `${c.ticker} ${c.indicator}: ${c.vlmSignal} vs truth ${c.fetchedSignal}`);
console.log(`\nVLM signal misses (${misses(vlmVsTruth).length}):`);
for (const m of misses(vlmVsTruth)) console.log(`  ${m}`);
console.log(`\nFetched signal misses (${misses(fetchedVsTruth).length}):`);
for (const m of misses(fetchedVsTruth)) console.log(`  ${m}`);
console.log();
