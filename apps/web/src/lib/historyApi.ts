import type { HistoryResponse } from '@/types/history';
import { apiUrl } from './api.ts';

/** Single-shot; recent history is small and cheap to fetch whole, no
 * job/poll needed. Public endpoint, no auth. */
export async function fetchHistory(ticker: string): Promise<HistoryResponse> {
  const res = await fetch(apiUrl(`/api/history/${encodeURIComponent(ticker)}`));
  return res.json();
}
