import type { SupabaseClient } from '@supabase/supabase-js';
import type { DeriveSignalOptions } from '@stock-indicator-dailies/shared';

import { getSupabaseClient } from './supabaseClient.ts';

export interface WatchlistRow {
  ticker: string;
  addedAt: string;
  /** Per-stock sensitivity override; null means "use app defaults." */
  settings: DeriveSignalOptions | null;
  /** This ticker's last-run scenario/custom Historical Testing settings
   * (the full 9-field IndicatorSettings shape); null means none saved yet.
   * Opaque here — never interpreted server-side, just stored and returned
   * verbatim for the frontend to auto-rerun. */
  scenarioSettings: Record<string, unknown> | null;
}

interface WatchlistTickerRecord {
  ticker: string;
  added_at: string;
  settings: DeriveSignalOptions | null;
  scenario_settings: Record<string, unknown> | null;
}

/** A user's watchlisted tickers, in their chosen display order (see
 * reorderWatchlist). Empty (not an error) when Supabase isn't configured or
 * the lookup fails; same degrade-to-noop posture as cache.ts, so a Supabase
 * hiccup here never crashes the request. */
export async function getWatchlist(userId: string): Promise<WatchlistRow[]> {
  const db = getSupabaseClient();
  if (!db) return [];

  try {
    const { data, error } = await db
      .from('watchlist_tickers')
      .select('ticker, added_at, settings, scenario_settings')
      .eq('user_id', userId)
      .order('sort_order', { ascending: true })
      .returns<WatchlistTickerRecord[]>();
    if (error || !data) return [];
    return data.map((row) => ({
      ticker: row.ticker,
      addedAt: row.added_at,
      settings: row.settings ?? null,
      scenarioSettings: row.scenario_settings ?? null,
    }));
  } catch {
    return [];
  }
}

/** One past the highest sort_order this user currently has (0 if they have
 * none yet), so a newly-added ticker lands at the end of the list. */
async function nextSortOrder(db: SupabaseClient, userId: string): Promise<number> {
  const { data } = await db
    .from('watchlist_tickers')
    .select('sort_order')
    .eq('user_id', userId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle<{ sort_order: number | null }>();
  return (data?.sort_order ?? -1) + 1;
}

/** Re-adding an already-watchlisted ticker updates its sensitivity
 * override rather than being ignored, so "add NVDA with different
 * settings" from the Manage Watchlist form actually overwrites the old
 * ones — without disturbing its added_at or its position in the list.
 * A genuinely new ticker gets a fresh sort_order placing it at the end. */
export async function addToWatchlist(userId: string, ticker: string, settings: DeriveSignalOptions | null = null): Promise<void> {
  const db = getSupabaseClient();
  if (!db) return;

  try {
    const { data: existing } = await db
      .from('watchlist_tickers')
      .select('ticker')
      .eq('user_id', userId)
      .eq('ticker', ticker)
      .maybeSingle();

    if (existing) {
      await db.from('watchlist_tickers').update({ settings }).eq('user_id', userId).eq('ticker', ticker);
    } else {
      const sortOrder = await nextSortOrder(db, userId);
      await db.from('watchlist_tickers').insert({ user_id: userId, ticker, settings, sort_order: sortOrder });
    }
  } catch {
    // Best-effort; never let a caching-adjacent write fail the request.
  }
}

/** Applies a user-chosen display order: `tickers` is the full desired
 * order, each getting its index as its new sort_order. Scoped to the
 * caller's own rows, so a client can only ever reorder its own list.
 * Tickers not in the caller's list (shouldn't happen from the UI, but not
 * trusted either) are simply no-ops, since the `eq('user_id', ...)` guard
 * means an update for a ticker the user doesn't have just matches nothing. */
export async function reorderWatchlist(userId: string, tickers: string[]): Promise<void> {
  const db = getSupabaseClient();
  if (!db) return;

  try {
    await Promise.all(
      tickers.map((ticker, index) =>
        db.from('watchlist_tickers').update({ sort_order: index }).eq('user_id', userId).eq('ticker', ticker),
      ),
    );
  } catch {
    // Best-effort.
  }
}

/** Updates only the sensitivity override for an existing row; does not
 * touch added_at. A no-op if the row doesn't exist (nothing to update). */
export async function updateWatchlistSettings(userId: string, ticker: string, settings: DeriveSignalOptions): Promise<void> {
  const db = getSupabaseClient();
  if (!db) return;

  try {
    await db.from('watchlist_tickers').update({ settings }).eq('user_id', userId).eq('ticker', ticker);
  } catch {
    // Best-effort.
  }
}

/** Updates only the scenario/custom backtest settings for an existing row;
 * does not touch `settings` (the live sensitivity override) or added_at.
 * A no-op if the row doesn't exist. */
export async function updateScenarioSettings(userId: string, ticker: string, settings: Record<string, unknown>): Promise<void> {
  const db = getSupabaseClient();
  if (!db) return;

  try {
    await db.from('watchlist_tickers').update({ scenario_settings: settings }).eq('user_id', userId).eq('ticker', ticker);
  } catch {
    // Best-effort.
  }
}

export async function removeFromWatchlist(userId: string, ticker: string): Promise<void> {
  const db = getSupabaseClient();
  if (!db) return;

  try {
    await db.from('watchlist_tickers').delete().eq('user_id', userId).eq('ticker', ticker);
  } catch {
    // Best-effort.
  }
}

/** Every distinct ticker watchlisted by any user, for the daily scheduler
 * to sweep. Watchlisting the same ticker across many users still only
 * costs one capture: runPipeline's own cache check short-circuits the rest. */
export async function getAllDistinctWatchlistedTickers(): Promise<string[]> {
  const db = getSupabaseClient();
  if (!db) return [];

  try {
    const { data, error } = await db
      .from('watchlist_tickers')
      .select('ticker')
      .returns<Array<{ ticker: string }>>();
    if (error || !data) return [];
    return Array.from(new Set(data.map((row) => row.ticker)));
  } catch {
    return [];
  }
}
