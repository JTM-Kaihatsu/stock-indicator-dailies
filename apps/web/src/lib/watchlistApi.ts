import type { WatchlistMutationResponse, WatchlistReportResponse, WatchlistResponse, WatchlistSettings } from '@/types/watchlist';
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
 * see it resolve. `settings` seeds the ticker's sensitivity override at
 * add time; omit (or pass app defaults) to use app defaults. */
export async function addTicker(
  accessToken: string,
  ticker: string,
  settings?: WatchlistSettings,
): Promise<WatchlistMutationResponse> {
  const res = await fetch(apiUrl('/api/watchlist'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ ticker, settings }),
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

/** Updates an existing watchlist entry's sensitivity override. */
export async function updateWatchlistSettings(
  accessToken: string,
  ticker: string,
  settings: WatchlistSettings,
): Promise<WatchlistMutationResponse> {
  const res = await fetch(apiUrl(`/api/watchlist/${encodeURIComponent(ticker)}`), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ settings }),
  });
  return res.json();
}

/** Persists this ticker's last-run scenario/custom Historical Testing
 * settings, so revisiting the ticker's page can restore and auto-rerun it.
 * Independent of the live sensitivity override above (a separate column). */
export async function updateScenarioSettings(
  accessToken: string,
  ticker: string,
  scenarioSettings: Record<string, unknown>,
): Promise<WatchlistMutationResponse> {
  const res = await fetch(apiUrl(`/api/watchlist/${encodeURIComponent(ticker)}`), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ scenarioSettings }),
  });
  return res.json();
}

/** The full recomputed report for one watchlisted ticker, using that
 * ticker's stored sensitivity override. Powers the single-stock result
 * page. Also doubles as the retry mechanism: a call here that finds no
 * fresh cache attempts a new run itself (rate-limited), so simply loading
 * this ticker's page is what "retrying it" means. */
export async function fetchWatchlistTickerReport(accessToken: string, ticker: string): Promise<WatchlistReportResponse> {
  const res = await fetch(apiUrl(`/api/watchlist/${encodeURIComponent(ticker)}/report`), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return res.json();
}

/** Persists a drag-reordered watchlist: `tickers` is the full desired
 * order. */
export async function reorderWatchlist(accessToken: string, tickers: string[]): Promise<WatchlistMutationResponse> {
  const res = await fetch(apiUrl('/api/watchlist/order'), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ tickers }),
  });
  return res.json();
}
