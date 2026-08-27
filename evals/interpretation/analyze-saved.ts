/**
 * Re-run the machine columns (VLM + fetched reads) against an ALREADY-CAPTURED
 * image on disk; without re-capturing, which would change the chart and
 * invalidate hand-labeled ground truth.
 *
 *   npm run analyze-saved -w @stock-indicator-dailies/eval-interpretation -- GOOG
 *
 * Reads eval-images/<TICKER>.png, makes ONE billed model call per ticker, and
 * prints the refreshed vlm and fetched columns as ready-to-paste CSV cells.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { analyzeChart, ClaudeVlmProvider } from '@stock-indicator-dailies/vlm';
import { computeReadings, yahooDataSource } from '@stock-indicator-dailies/indicators';

import { compareReadings } from './src/fact-score.ts';

const tickers = process.argv.slice(2).map((t) => t.toUpperCase());
if (tickers.length === 0) {
  console.error('usage: npm run analyze-saved -w @stock-indicator-dailies/eval-interpretation -- TICKER [...]');
  process.exit(1);
}

const dir = path.resolve(process.env.INIT_CWD ?? process.cwd(), 'eval-images');
const provider = new ClaudeVlmProvider();
const csv = (v: unknown) => {
  const s = v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

for (const ticker of tickers) {
  const file = path.join(dir, `${ticker}.png`);
  const base64 = readFileSync(file).toString('base64');

  const result = await analyzeChart({ ticker, image: { base64, mediaType: 'image/png' }, provider });
  if (!result.ok) {
    console.error(`${ticker}: VLM failed; ${result.errors.join('; ')}`);
    continue;
  }
  const { bars } = await yahooDataSource.fetchDailyBars(ticker, '1y');
  const fetched = computeReadings(bars);
  const comparisons = compareReadings(result.verdict.readings, fetched, {}, ticker);

  console.log(`\n### ${ticker}  (visibleRange: ${result.verdict.visibleRange ?? 'N/A'})`);
  for (const c of comparisons) {
    const vBars = c.vlm.crossover === 'NONE' ? '' : (c.vlm.barsAgo ?? '');
    const fBars = c.fetched.crossover === 'NONE' ? '' : (c.fetched.barsAgo ?? '');
    // ticker,image,indicator, vlm_crossover,vlm_barsAgo,vlm_qualified,vlm_signal,vlm_rationale,
    // fetched_crossover,fetched_barsAgo,fetched_qualified,fetched_signal, direction_match,barsAgo_gap,signal_match
    console.log(
      [
        ticker,
        `eval-images/${ticker}.png`,
        c.indicator,
        c.vlm.crossover,
        vBars,
        c.vlm.qualified,
        c.vlmSignal,
        c.vlm.rationale ?? '',
        c.fetched.crossover,
        fBars,
        c.fetched.qualified,
        c.fetchedSignal,
        c.directionMatch,
        c.bothCrossed ? c.barsAgoGap : '',
        c.signalMatch,
      ]
        .map(csv)
        .join(','),
    );
  }
}
