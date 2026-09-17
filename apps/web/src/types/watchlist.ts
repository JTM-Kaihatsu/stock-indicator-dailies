/**
 * Local duplication of the watchlist API's wire shapes, same precedent as
 * types/api.ts and types/advisor.ts: not worth importing a backend package
 * for a couple of small types.
 */
import type { DeriveSignalOptions, Signal } from '@stock-indicator-dailies/shared';
import type { DailyReport } from '@/types/api';

export type WatchlistSettings = DeriveSignalOptions;

export type WatchlistTickerStatus = 'ready' | 'running' | 'failed' | 'stale';

export interface WatchlistDashboardRow {
  ticker: string;
  overall: Signal | null;
  computed: Signal | null;
  ai: Signal | null;
  asOf: string | null;
  /** 'ready' fresh · 'running' capture in flight · 'stale' a real read on
   * record but past the 24h window with no newer failure (signal shown is
   * last known; the next sweep refreshes it) · 'failed' nothing on record,
   * or the last attempt failed. */
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
  | {
      ok: true;
      report: DailyReport;
      settings: WatchlistSettings | null;
      scenarioSettings: Record<string, unknown> | null;
      /** When the shown report was captured (ISO). */
      retrievedAt: string;
      /** Past the 24h freshness window; the next 7am sweep will refresh it. */
      stale: boolean;
      /** ISO time the manual Refresh button becomes usable again (1h after
       * the last capture attempt); null means usable now. */
      refreshAvailableAt: string | null;
    }
  | { ok: false; reason: string; pending: true }
  /** Rate-limited: too soon since the last attempt to try again. `userMessage`
   * is present when the last failure looked like a provider/TradingView
   * outage, absent for an ordinary failure. */
  | { ok: false; pending: false; stage: string; reason: string; userMessage?: string };

export type WatchlistRefreshResponse =
  | { ok: true; pending: true }
  /** `reason: 'cooldown'` carries `refreshAvailableAt`; other reasons are
   * plain errors (not on watchlist, misconfig). */
  | { ok: false; reason: string; refreshAvailableAt?: string };

/** Whole-watchlist (not per-ticker) preference: a single daily digest
 * email when any watchlisted ticker's Overall signal transitions into or
 * between BUY/SELL. */
export type WatchlistNotificationResponse =
  | { ok: true; emailOnSignal: boolean }
  | { ok: false; reason: string };
