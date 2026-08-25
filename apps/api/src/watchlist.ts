import { getSupabaseClient } from './supabaseClient.ts';

export interface WatchlistRow {
  ticker: string;
  addedAt: string;
}

interface WatchlistTickerRecord {
  ticker: string;
  added_at: string;
}

/** A user's watchlisted tickers, oldest-added first. Empty (not an error)
 * when Supabase isn't configured or the lookup fails; same degrade-to-noop
 * posture as cache.ts, so a Supabase hiccup here never crashes the request. */
export async function getWatchlist(userId: string): Promise<WatchlistRow[]> {
  const db = getSupabaseClient();
  if (!db) return [];

  try {
    const { data, error } = await db
      .from('watchlist_tickers')
      .select('ticker, added_at')
      .eq('user_id', userId)
      .order('added_at', { ascending: true })
      .returns<WatchlistTickerRecord[]>();
    if (error || !data) return [];
    return data.map((row) => ({ ticker: row.ticker, addedAt: row.added_at }));
  } catch {
    return [];
  }
}

/** Idempotent: adding an already-watchlisted ticker is a no-op, not an
 * error, thanks to the (user_id, ticker) primary key + upsert. */
export async function addToWatchlist(userId: string, ticker: string): Promise<void> {
  const db = getSupabaseClient();
  if (!db) return;

  try {
    await db.from('watchlist_tickers').upsert(
      { user_id: userId, ticker, added_at: new Date().toISOString() },
      { onConflict: 'user_id,ticker', ignoreDuplicates: true },
    );
  } catch {
    // Best-effort; never let a caching-adjacent write fail the request.
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
