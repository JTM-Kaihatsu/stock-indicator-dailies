import {
  deriveSignal,
  type IndicatorReading,
} from '@stock-indicator-dailies/shared';

import type { FactComparison } from './fact-score.ts';
import type { ChartEvalResult, EvalRun } from './harness.ts';

/**
 * Export a run as CSV; one row per (ticker, indicator); for manual labeling.
 *
 * Both reads are laid out side by side (`vlm_*` and `fetched_*`) with their
 * agreement flags, and the `truth_*` / `notes` columns are left BLANK: the user
 * opens this in Excel and fills in the ground truth by hand, since neither the
 * VLM nor the fetched read is authoritative. Opens directly in Excel/Sheets.
 */
/** Where capture-images.ts / the harness write per-ticker evidence PNGs. */
const IMAGE_DIR = 'eval-images';

const COLUMNS = [
  'ticker',
  'image',
  'indicator',
  'vlm_crossover',
  'vlm_barsAgo',
  'vlm_qualified',
  'vlm_signal',
  'vlm_rationale',
  'fetched_crossover',
  'fetched_barsAgo',
  'fetched_qualified',
  'fetched_signal',
  'direction_match',
  'barsAgo_gap',
  'signal_match',
  // --- blank columns for the user to label by hand ---
  'truth_crossover',
  'truth_barsAgo',
  'truth_qualified',
  'notes',
  // --- overall suggestion (per-ticker, populated on first indicator row) ---
  'vlm_suggestion',
  'fetched_suggestion',
  'truth_suggestion',
] as const;

/** Quote a cell if it contains a comma, quote, or newline; escape inner quotes. */
function cell(value: unknown): string {
  const s = value === undefined || value === null ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const barsAgo = (r: IndicatorReading) => (r.crossover === 'NONE' ? '' : (r.barsAgo ?? ''));

interface SuggestionCells {
  vlm: string;
  fetched: string;
  truth: string;
}

function comparisonRow(ticker: string, c: FactComparison, suggestion?: SuggestionCells): string {
  return [
    ticker,
    `${IMAGE_DIR}/${ticker}.png`,
    c.indicator,
    c.vlm.crossover,
    barsAgo(c.vlm),
    c.vlm.qualified,
    c.vlmSignal,
    c.vlm.rationale ?? '',
    c.fetched.crossover,
    barsAgo(c.fetched),
    c.fetched.qualified,
    c.fetchedSignal,
    c.directionMatch,
    c.bothCrossed ? c.barsAgoGap : '',
    c.signalMatch,
    '', // truth_crossover; user fills
    '', // truth_barsAgo; user fills
    '', // truth_qualified; user fills
    '', // notes; user fills
    suggestion?.vlm ?? '',
    suggestion?.fetched ?? '',
    suggestion?.truth ?? '',
  ]
    .map(cell)
    .join(',');
}

/** A failed chart still gets a row: the failure in `notes`, and; when a
 * diagnostic image was saved; the `image` column points at it so it can be
 * eyeballed. */
function failureRow(r: ChartEvalResult): string {
  const image = r.imagePath ? `${IMAGE_DIR}/${r.ticker}.FAILED.png` : '';
  const cells = COLUMNS.map((col) =>
    col === 'ticker' ? r.ticker : col === 'image' ? image : col === 'notes' ? `FAILED; ${r.error}` : '',
  );
  return cells.map(cell).join(',');
}

export function toCsv(run: EvalRun): string {
  const rows = [COLUMNS.join(',')];
  for (const r of run.results) {
    if (!r.ok || !r.comparisons) {
      rows.push(failureRow(r));
      continue;
    }
    const vlmSuggestion = deriveSignal(r.comparisons.map((c) => c.vlm));
    const fetchedSuggestion = deriveSignal(r.comparisons.map((c) => c.fetched));
    for (let i = 0; i < r.comparisons.length; i++) {
      const suggestion = i === 0
        ? { vlm: vlmSuggestion, fetched: fetchedSuggestion, truth: '' }
        : undefined;
      rows.push(comparisonRow(r.ticker, r.comparisons[i]!, suggestion));
    }
  }
  return rows.join('\n') + '\n';
}
