import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/** Lazily construct the shared Supabase client. Undefined when unconfigured,
 * so every caller degrades to a no-op rather than crashing. Previously
 * duplicated in cache.ts and advisorCache.ts; extracted here so a third
 * copy (watchlist.ts) doesn't triplicate it, and so the auth middleware
 * (which needs the same client to verify a JWT via auth.getUser) shares it
 * too. */
let client: SupabaseClient | undefined;

export function getSupabaseClient(): SupabaseClient | undefined {
  if (client) return client;
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return undefined;
  client = createClient(url, key);
  return client;
}
