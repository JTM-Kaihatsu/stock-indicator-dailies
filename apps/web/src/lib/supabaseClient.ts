import { createClient } from '@supabase/supabase-js';

/**
 * Auth-only client. This is never used to query chart_cache, advisor_cache,
 * or watchlist_tickers directly; every table grants access to service_role
 * only (no RLS policies for anon/authenticated), so all data access goes
 * through apps/api instead, which verifies the caller's JWT server-side.
 * The only calls this client should ever make are `supabase.auth.*`.
 */
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
);
