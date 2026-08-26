import { createClient } from '@supabase/supabase-js';

/**
 * Auth-only client. This is never used to query chart_cache, advisor_cache,
 * or watchlist_tickers directly; every table grants access to service_role
 * only (no RLS policies for anon/authenticated), so all data access goes
 * through apps/api instead, which verifies the caller's JWT server-side.
 * The only calls this client should ever make are `supabase.auth.*`.
 *
 * Falls back to a placeholder URL/key when the env vars aren't present.
 * `createClient` throws synchronously on an empty URL, and this module is
 * imported (transitively, via useAuth) by pages Next statically prerenders
 * at build time (e.g. /auth/callback) — a missing var there would fail the
 * entire build rather than just leaving auth non-functional. Every actual
 * `supabase.auth.*` call happens client-side in the browser, where the real
 * values are inlined at build time when present.
 */
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key',
);
