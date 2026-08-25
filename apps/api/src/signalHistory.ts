import type { DailyReport } from '@stock-indicator-dailies/daily';
import { resolveDualOverall, type Signal } from '@stock-indicator-dailies/shared';

import { getSupabaseClient } from './supabaseClient.ts';

export interface SignalHistoryEntry {
  ticker: string;
  capturedAt: string;
  overall: Signal;
  computed: Signal | null;
  ai: Signal;
}

export interface SignalHistoryRecord {
  ticker: string;
  captured_at: string;
  overall: Signal;
  computed: Signal | null;
  ai: Signal;
}

/** Append one row for a successful capture. Best-effort, same posture as
 * cacheReport/logFailure: a Supabase hiccup here must never turn an
 * already-successful analysis into a reported failure for the caller. */
export async function logSignalHistory(report: DailyReport): Promise<void> {
  const db = getSupabaseClient();
  if (!db) return;

  try {
    const computed = report.deterministic?.signal ?? null;
    const ai = report.verdict.signal;
    await db.from('signal_history').insert({
      ticker: report.ticker,
      overall: resolveDualOverall(computed, ai),
      computed,
      ai,
    });
  } catch {
    // Best-effort; never let history logging fail an otherwise-successful request.
  }
}

/** The last `limit` captures for one ticker, most recent first. Empty (not
 * an error) on any failure, same degrade-to-noop posture as the rest of
 * this codebase's Supabase access. */
export async function getRecentHistory(ticker: string, limit = 10): Promise<SignalHistoryEntry[]> {
  const db = getSupabaseClient();
  if (!db) return [];

  try {
    const { data, error } = await db
      .from('signal_history')
      .select('ticker, captured_at, overall, computed, ai')
      .eq('ticker', ticker)
      .order('captured_at', { ascending: false })
      .limit(limit)
      .returns<SignalHistoryRecord[]>();
    if (error || !data) return [];
    return data.map(toEntry);
  } catch {
    return [];
  }
}

/**
 * For each of `tickers`, the timestamp since which its Overall signal has
 * held its current value; `null` if there's no history yet. Used by the
 * watchlist dashboard's "last changed" column.
 *
 * One batched query (not one per ticker): fetches every row for the given
 * tickers from the last `windowDays`, then walks each ticker's rows
 * (already sorted newest-first) to find how far back the current value
 * has held. 90 days is generous slack for a once-a-day cadence; a ticker
 * whose Overall hasn't changed in 90 days just reports the oldest row in
 * that window, not literally 90 days ago.
 */
export async function getLastChangedMap(tickers: string[], windowDays = 90): Promise<Map<string, string | null>> {
  const result = new Map<string, string | null>(tickers.map((t) => [t, null]));
  if (tickers.length === 0) return result;

  const db = getSupabaseClient();
  if (!db) return result;

  try {
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await db
      .from('signal_history')
      .select('ticker, captured_at, overall, computed, ai')
      .in('ticker', tickers)
      .gte('captured_at', since)
      .order('captured_at', { ascending: false })
      .returns<SignalHistoryRecord[]>();
    if (error || !data) return result;

    const byTicker = new Map<string, SignalHistoryRecord[]>();
    for (const row of data) {
      const list = byTicker.get(row.ticker) ?? [];
      list.push(row);
      byTicker.set(row.ticker, list);
    }

    for (const [ticker, rows] of byTicker) {
      result.set(ticker, lastChangedAt(rows));
    }
    return result;
  } catch {
    return result;
  }
}

/** `rows` must be newest-first. Walks forward from the most recent row
 * while `overall` stays the same, returning the captured_at of the oldest
 * row in that run; i.e. "since when has it been this value." Exported for
 * direct unit testing; not used outside this module otherwise. */
export function lastChangedAt(rows: SignalHistoryRecord[]): string | null {
  if (rows.length === 0) return null;
  const current = rows[0]!.overall;
  let earliestMatching = rows[0]!.captured_at;
  for (const row of rows) {
    if (row.overall !== current) break;
    earliestMatching = row.captured_at;
  }
  return earliestMatching;
}

function toEntry(row: SignalHistoryRecord): SignalHistoryEntry {
  return { ticker: row.ticker, capturedAt: row.captured_at, overall: row.overall, computed: row.computed, ai: row.ai };
}
