/** Local duplication of the history API's wire shapes, same precedent as
 * types/api.ts, types/advisor.ts, and types/watchlist.ts. */
import type { Signal } from '@stock-indicator-dailies/shared';

export interface SignalHistoryEntry {
  ticker: string;
  capturedAt: string;
  overall: Signal;
  computed: Signal | null;
  ai: Signal;
}

export type HistoryResponse =
  | { ok: true; entries: SignalHistoryEntry[] }
  | { ok: false; reason: string };
