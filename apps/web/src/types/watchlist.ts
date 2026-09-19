/**
 * Local duplication of the watchlist API's wire shapes, same precedent as
 * types/api.ts and types/advisor.ts: not worth importing a backend package
 * for a couple of small types.
 */
import type { DeriveSignalOptions, Signal } from '@stock-indicator-dailies/shared';
import type { DailyReport } from '@/types/api';

export type WatchlistSettings = DeriveSignalOptions;

export type WatchlistTickerStatus = 'ready' | 'running' | 'failed' | 'stale';

/** One recorded buy or sell lot for a ticker. Multiple lots over time make
 * up the full position; realized gains are computed FIFO across them (see
 * apps/api/src/positionRisk.ts). */
export interface PositionLot {
  id: string;
  action: 'buy' | 'sell';
  tradeDate: string;
  shares: number;
  price: number;
  createdAt: string;
}

/** One row of the position ledger table: a lot plus the running totals
 * immediately after it, in trade order. realizedGain/Pct/costBasis are
 * null for a buy row (a buy never itself realizes anything). */
export interface LedgerRow {
  lot: PositionLot;
  totalHeldShares: number;
  realizedGain: number | null;
  realizedGainPct: number | null;
  /** $ cost basis of the shares this sell consumed; lets the panel sum a
   * correctly weighted realized % across every sell instead of averaging
   * already-weighted per-row percentages. */
  costBasis: number | null;
}

/** Only present when both a position and ATR settings (Indicator
 * Settings' "Enable ATR stop-loss") are set for this ticker. */
export interface PositionRisk {
  currentPrice: number;
  peakSinceEntry: number;
  atrValue: number;
  atrMultiplier: number;
  atrPeriod: number;
  stopLevel: number;
  triggered: boolean;
}

export interface UnrealizedPnl {
  amount: number;
  pct: number;
  /** $ cost basis of currently open lots; combines with LedgerRow.costBasis
   * to compute a correctly weighted "Total Value" percentage. */
  costBasis: number;
}

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
  /** Total shares currently held across all open (not yet sold) lots; 0
   * means nothing currently held. */
  heldShares: number;
  /** The oldest still-open lot's trade date; null whenever heldShares is 0. */
  sinceDate: string | null;
  positionRisk: PositionRisk | null;
  /** Present exactly when positionRisk.triggered forced `overall` to
   * 'SELL'; explains why in plain language for display. */
  overallOverrideReason: string | null;
  unrealizedPnl: UnrealizedPnl | null;
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
      /** The Overall signal, already reflecting the position-risk override
       * (if any) below; use this instead of report.verdict/deterministic
       * when displaying the headline Overall read. */
      overall: Signal | null;
      lots: PositionLot[];
      ledgerRows: LedgerRow[];
      positionRisk: PositionRisk | null;
      overallOverrideReason: string | null;
      unrealizedPnl: UnrealizedPnl | null;
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

export type LotMutationResponse =
  | { ok: true; lots: PositionLot[]; ledgerRows: LedgerRow[] }
  | { ok: false; reason: string };

export type DayRangeResponse =
  | { ok: true; low: number; high: number }
  | { ok: false; reason: string };
