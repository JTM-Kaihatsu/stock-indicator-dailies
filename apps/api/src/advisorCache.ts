import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AdvisorResult, ProposedSettings } from '@stock-indicator-dailies/advisor';

/** A cached row is fresh for this long from `retrieved_at`; older is a miss.
 * A week, not chart_cache's 24h: a company's research profile doesn't go
 * stale hour-to-hour the way a chart does, and the point of caching this at
 * all is mainly to avoid repeated slow, web-search-backed calls during
 * testing and demos. */
const CACHE_WINDOW_HOURS = 24 * 7;

let client: SupabaseClient | undefined;

/** Lazily construct the Supabase client. Undefined when unconfigured, so the
 * cache degrades to a no-op rather than crashing the request. */
function getClient(): SupabaseClient | undefined {
  if (client) return client;
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return undefined;
  client = createClient(url, key);
  return client;
}

interface AdvisorCacheRow {
  ticker: string;
  retrieved_at: string;
  rationale: string;
  settings: ProposedSettings;
}

/** Look up a fresh cached suggestion for `ticker`. `null` on a miss, an
 * expired row, or when Supabase isn't configured; all treated the same by
 * the caller. Also `null` on a Supabase-side failure: called directly in
 * the /advisor/start route handler, so an unguarded throw here would crash
 * that request outright instead of degrading to "no cache, research fresh."
 * Same reasoning as getCachedReport in cache.ts. */
export async function getCachedAdvice(ticker: string): Promise<AdvisorResult | null> {
  const db = getClient();
  if (!db) return null;

  try {
    const { data, error } = await db
      .from('advisor_cache')
      .select('ticker, retrieved_at, rationale, settings')
      .eq('ticker', ticker)
      .maybeSingle<AdvisorCacheRow>();
    if (error || !data) return null;

    const ageMs = Date.now() - new Date(data.retrieved_at).getTime();
    if (ageMs > CACHE_WINDOW_HOURS * 60 * 60 * 1000) return null;

    return { rationale: data.rationale, settings: data.settings };
  } catch {
    return null;
  }
}

/** Persist a fresh suggestion, overwriting any prior row for the ticker.
 * Best-effort: caching is an optimization, not part of the actual result,
 * so a Supabase hiccup here must never turn an already-successful research
 * call into a reported failure for the caller. */
export async function cacheAdvice(ticker: string, result: AdvisorResult): Promise<void> {
  const db = getClient();
  if (!db) return;

  try {
    await db.from('advisor_cache').upsert({
      ticker,
      retrieved_at: new Date().toISOString(),
      rationale: result.rationale,
      settings: result.settings,
    });
  } catch {
    // Best-effort; never let caching itself fail an otherwise-successful request.
  }
}
