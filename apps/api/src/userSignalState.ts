import type { Signal } from '@stock-indicator-dailies/shared';
import { getSupabaseClient } from './supabaseClient.ts';

interface UserSignalStateRow {
  ticker: string;
  overall: Signal;
}

/** Every ticker's last-evaluated Overall signal on record for this user,
 * computed with their own sensitivity settings (see notifications.ts).
 * Empty map (not an error) on any failure or a user with no history yet. */
export async function getUserSignalStates(userId: string): Promise<Map<string, Signal>> {
  const db = getSupabaseClient();
  if (!db) return new Map();

  try {
    const { data, error } = await db
      .from('user_signal_state')
      .select('ticker, overall')
      .eq('user_id', userId)
      .returns<UserSignalStateRow[]>();
    if (error || !data) return new Map();
    return new Map(data.map((row) => [row.ticker, row.overall]));
  } catch {
    return new Map();
  }
}

/** Persists this user's freshly-evaluated per-ticker signals, overwriting
 * whatever was on record. Called every sweep regardless of whether
 * anything changed, so the next comparison is always against today's real
 * value. Best-effort; a write failure here just means tomorrow's
 * comparison degrades to "no prior state" for the affected ticker(s),
 * which is a missed notification at worst, not a wrong one. */
export async function setUserSignalStates(userId: string, states: Map<string, Signal>): Promise<void> {
  const db = getSupabaseClient();
  if (!db || states.size === 0) return;

  const now = new Date().toISOString();
  const rows = Array.from(states, ([ticker, overall]) => ({
    user_id: userId,
    ticker,
    overall,
    updated_at: now,
  }));

  try {
    await db.from('user_signal_state').upsert(rows);
  } catch {
    // Best-effort.
  }
}
