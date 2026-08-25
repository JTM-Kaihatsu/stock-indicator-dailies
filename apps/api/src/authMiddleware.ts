import type { Context, Next } from 'hono';

import { getSupabaseClient } from './supabaseClient.ts';

declare module 'hono' {
  interface ContextVariableMap {
    userId: string;
  }
}

/**
 * Verifies the caller's Supabase Auth JWT and attaches the verified user id
 * to the request context. This is the only authorization mechanism for
 * watchlist routes; there are no RLS policies backing watchlist_tickers
 * (same service_role-only pattern as every other table), so every route
 * downstream of this middleware must scope its queries by `c.get('userId')`,
 * never by a client-supplied id.
 */
export async function requireAuth(c: Context, next: Next): Promise<Response | void> {
  const header = c.req.header('Authorization');
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
  if (!token) return c.json({ ok: false, reason: 'Unauthorized' }, 401);

  const db = getSupabaseClient();
  if (!db) return c.json({ ok: false, reason: 'Auth not configured' }, 503);

  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) return c.json({ ok: false, reason: 'Unauthorized' }, 401);

  c.set('userId', data.user.id);
  await next();
}
