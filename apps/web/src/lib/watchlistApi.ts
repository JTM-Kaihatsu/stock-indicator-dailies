import type { WatchlistMutationResponse, WatchlistResponse } from '@/types/watchlist';
import { apiUrl } from './api.ts';

/** Single-shot; the dashboard reads pre-computed data (populated by the
 * 7am ET sweep or a prior ad-hoc add), no job/poll needed. */
export async function fetchWatchlist(accessToken: string): Promise<WatchlistResponse> {
  const res = await fetch(apiUrl('/api/watchlist'), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return res.json();
}

/** Returns immediately; the server fires a one-off capture in the
 * background rather than making the caller wait. Poll fetchWatchlist to
 * see it resolve. */
export async function addTicker(accessToken: string, ticker: string): Promise<WatchlistMutationResponse> {
  const res = await fetch(apiUrl('/api/watchlist'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ ticker }),
  });
  return res.json();
}

export async function removeTicker(accessToken: string, ticker: string): Promise<WatchlistMutationResponse> {
  const res = await fetch(apiUrl(`/api/watchlist/${encodeURIComponent(ticker)}`), {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return res.json();
}
