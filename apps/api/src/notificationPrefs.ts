import { getSupabaseClient } from './supabaseClient.ts';

/** Whether this user wants a single daily digest email when any of their
 * watchlisted tickers' Overall signal transitions into or between
 * BUY/SELL. Whole-watchlist, not per-ticker — there is exactly one of
 * these per user. */
export async function getEmailOnSignal(userId: string): Promise<boolean> {
  const db = getSupabaseClient();
  if (!db) return false;

  try {
    const { data, error } = await db
      .from('watchlist_notification_prefs')
      .select('email_on_signal')
      .eq('user_id', userId)
      .maybeSingle<{ email_on_signal: boolean }>();
    if (error || !data) return false;
    return data.email_on_signal;
  } catch {
    return false;
  }
}

/** Sets the preference, upserting so both "turn it on" and "turn it off"
 * go through the same single write path. */
export async function setEmailOnSignal(userId: string, enabled: boolean): Promise<void> {
  const db = getSupabaseClient();
  if (!db) return;

  try {
    await db
      .from('watchlist_notification_prefs')
      .upsert({ user_id: userId, email_on_signal: enabled, updated_at: new Date().toISOString() });
  } catch {
    // Best-effort, same posture as every other preference write here.
  }
}

/** Every user id with the digest enabled, for the daily sweep to iterate.
 * Empty (not an error) on any failure. */
export async function getUsersWithEmailOnSignal(): Promise<string[]> {
  const db = getSupabaseClient();
  if (!db) return [];

  try {
    const { data, error } = await db
      .from('watchlist_notification_prefs')
      .select('user_id')
      .eq('email_on_signal', true)
      .returns<Array<{ user_id: string }>>();
    if (error || !data) return [];
    return data.map((row) => row.user_id);
  } catch {
    return [];
  }
}
