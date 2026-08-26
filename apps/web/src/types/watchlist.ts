/**
 * Local duplication of the watchlist API's wire shapes, same precedent as
 * types/api.ts and types/advisor.ts: not worth importing a backend package
 * for a couple of small types.
 */
import type { DeriveSignalOptions, Signal } from '@stock-indicator-dailies/shared';
import type { DailyReport } from '@/types/api';

export type WatchlistSettings = DeriveSignalOptions;

export type WatchlistTickerStatus = 'ready' | 'running' | 'failed';

export interface WatchlistDashboardRow {
  ticker: string;
  overall: Signal | null;
  computed: Signal | null;
  ai: Signal | null;
  asOf: string | null;
  status: WatchlistTickerStatus;
  /** Since when the Overall signal has held its current value; null if
   * there's no history yet. */
  lastChangedAt: string | null;
  /** This ticker's sensitivity override; null means app defaults. */
  settings: WatchlistSettings | null;
}

export type WatchlistResponse =
  | { ok: true; rows: WatchlistDashboardRow[] }
  | { ok: false; reason: string };

export type WatchlistMutationResponse =
  | { ok: true; ticker?: string; pending?: boolean; settings?: WatchlistSettings }
  | { ok: false; reason: string };

export type WatchlistReportResponse =
  | { ok: true; report: DailyReport; settings: WatchlistSettings | null }
  | { ok: false; reason: string; pending: true }
  /** Rate-limited: too soon since the last attempt to try again. `userMessage`
   * is present when the last failure looked like a provider/TradingView
   * outage, absent for an ordinary failure. */
  | { ok: false; pending: false; stage: string; reason: string; userMessage?: string };
