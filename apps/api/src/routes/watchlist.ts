import { Hono } from 'hono';
import { yahooDataSource } from '@stock-indicator-dailies/indicators';
import { outageMessageFor, recomputeReport, resolveDualOverall, type DeriveSignalOptions, type RiskTolerance, type Signal } from '@stock-indicator-dailies/shared';

import { getCachedReportDetail, getCachedReportMeta, getLatestFailure } from '../cache.ts';
import { canAttempt, isRunning, runPipeline } from '../pipeline.ts';
import { computeRefreshAvailableAt } from '../refreshCooldown.ts';
import { parseTicker } from '../ticker.ts';
import {
  addToWatchlist,
  clearLots,
  deleteLot,
  getAllPositionLotsForUser,
  getPositionLots,
  getWatchlist,
  insertLot,
  removeFromWatchlist,
  reorderWatchlist,
  updateLot,
  updateScenarioSettings,
  updateWatchlistSettings,
  type LotInput,
  type WatchlistRow,
} from '../watchlist.ts';
import { requireAuth } from '../authMiddleware.ts';
import { runDailyWatchlistJobAndNotify } from '../scheduler.ts';
import { getLastChangedMap } from '../signalHistory.ts';
import { getEmailOnSignal, setEmailOnSignal } from '../notificationPrefs.ts';
import {
  computeLedger,
  computePositionRisk,
  computeUnrealizedPnl,
  type LedgerRow,
  type PositionLot,
  type PositionRisk,
  type UnrealizedPnl,
} from '../positionRisk.ts';

export const watchlistRoute = new Hono();

export type WatchlistTickerStatus = 'ready' | 'running' | 'failed' | 'stale';

export interface WatchlistDashboardRow {
  ticker: string;
  overall: Signal | null;
  computed: Signal | null;
  ai: Signal | null;
  asOf: string | null;
  /**
   * 'ready'   fresh read (within the 24h window)
   * 'running' a capture is in flight now
   * 'stale'   a real read on record but past 24h, with no newer failure;
   *           the signal shown is the last known one, and the next morning
   *           sweep will refresh it
   * 'failed'  no read on record, or the most recent attempt actually failed
   */
  status: WatchlistTickerStatus;
  /** Since when the Overall signal has held its current value; null if
   * there's no history yet (e.g. still pending its first capture). */
  lastChangedAt: string | null;
  /** This ticker's sensitivity override; null means app defaults. */
  settings: DeriveSignalOptions | null;
  /** Total shares currently held across all open (not yet sold) lots; 0
   * means nothing currently held (whether never bought or fully sold). */
  heldShares: number;
  /** The oldest still-open lot's trade date (FIFO's current position-risk
   * anchor); null whenever heldShares is 0. */
  sinceDate: string | null;
  /** Only computed when something is held and ATR settings are set; null
   * otherwise. When `triggered`, `overall` above has already been forced
   * to 'SELL' and `overallOverrideReason` explains why. */
  positionRisk: PositionRisk | null;
  overallOverrideReason: string | null;
  unrealizedPnl: UnrealizedPnl | null;
}

/** Applies the live ATR sell-point override to one row's Overall signal, in
 * place of whatever resolveDualOverall computed: holding shares and
 * setting ATR stop-loss in Indicator Settings is an explicit choice
 * to have this ticker's stop level watched, so a breach takes priority
 * over the ordinary computed/AI disagreement-resolution logic. Only ever
 * forces SELL, never overrides a HOLD/BUY read that isn't actually
 * breached. Best-effort: a fetch failure inside computePositionRisk
 * degrades to "no override," not a broken row. */
async function applyPositionRisk(
  ticker: string,
  lots: PositionLot[],
  currentPrice: number | null,
  overall: Signal | null,
  atrMultiplier: number | undefined,
  atrPeriod: number | undefined,
): Promise<
  Pick<WatchlistDashboardRow, 'heldShares' | 'sinceDate' | 'positionRisk' | 'overallOverrideReason' | 'unrealizedPnl'> & {
    overall: Signal | null;
  }
> {
  const { openLots } = computeLedger(lots);
  const heldShares = openLots.reduce((sum, lot) => sum + lot.shares, 0);
  const sinceDate =
    openLots.length > 0 ? openLots.reduce((min, lot) => (lot.tradeDate < min ? lot.tradeDate : min), openLots[0]!.tradeDate) : null;

  if (openLots.length === 0) {
    return { heldShares: 0, sinceDate: null, positionRisk: null, overallOverrideReason: null, unrealizedPnl: null, overall };
  }

  const unrealizedPnl = currentPrice !== null ? computeUnrealizedPnl(openLots, currentPrice) : null;

  if (atrMultiplier === undefined || atrPeriod === undefined) {
    return { heldShares, sinceDate, positionRisk: null, overallOverrideReason: null, unrealizedPnl, overall };
  }

  const positionRisk = await computePositionRisk(ticker, openLots, atrMultiplier, atrPeriod);
  if (!positionRisk?.triggered) {
    return { heldShares, sinceDate, positionRisk, overallOverrideReason: null, unrealizedPnl, overall };
  }

  const reason =
    `Overall forced to SELL: price ($${positionRisk.currentPrice.toFixed(2)}) fell below your ATR stop ` +
    `($${positionRisk.stopLevel.toFixed(2)} = peak $${positionRisk.peakSinceEntry.toFixed(2)} since entry minus ` +
    `${positionRisk.atrMultiplier}x the ${positionRisk.atrPeriod}-day ATR of $${positionRisk.atrValue.toFixed(2)}).`;
  return { heldShares, sinceDate, positionRisk, overallOverrideReason: reason, unrealizedPnl, overall: 'SELL' };
}

const RISK_TOLERANCES: readonly RiskTolerance[] = ['averse', 'neutral', 'seeking'];

/** Picks out only the 8 recognized fields, dropping anything else and any
 * invalid value. Not a full schema validator; a malformed field degrading
 * to "unset" (app default) is an acceptable failure mode here. Bounds for
 * the ATR/ADX fields mirror apps/api/src/routes/backtest.ts's clampOptions. */
function parseSettings(raw: unknown): DeriveSignalOptions | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const out: DeriveSignalOptions = {};
  if (typeof r.buyConsensus === 'number' && Number.isFinite(r.buyConsensus)) out.buyConsensus = r.buyConsensus;
  if (typeof r.sellConsensus === 'number' && Number.isFinite(r.sellConsensus)) out.sellConsensus = r.sellConsensus;
  if (typeof r.recencyDays === 'number' && Number.isFinite(r.recencyDays)) out.recencyDays = r.recencyDays;
  if (typeof r.riskTolerance === 'string' && RISK_TOLERANCES.includes(r.riskTolerance as RiskTolerance)) {
    out.riskTolerance = r.riskTolerance as RiskTolerance;
  }
  if (typeof r.atrMultiplier === 'number' && Number.isFinite(r.atrMultiplier) && r.atrMultiplier >= 0 && r.atrMultiplier <= 20) {
    out.atrMultiplier = r.atrMultiplier;
  }
  if (typeof r.atrPeriod === 'number' && Number.isFinite(r.atrPeriod) && r.atrPeriod >= 2 && r.atrPeriod <= 100) {
    out.atrPeriod = r.atrPeriod;
  }
  if (typeof r.adxThreshold === 'number' && Number.isFinite(r.adxThreshold) && r.adxThreshold >= 0 && r.adxThreshold <= 100) {
    out.adxThreshold = r.adxThreshold;
  }
  if (typeof r.adxPeriod === 'number' && Number.isFinite(r.adxPeriod) && r.adxPeriod >= 2 && r.adxPeriod <= 100) {
    out.adxPeriod = r.adxPeriod;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Validates the full 9-field scenario/custom Historical Testing shape sent
 * by the frontend's IndicatorSettings; stored and returned opaquely (never
 * interpreted server-side), so this only guards against a malformed blob
 * silently corrupting the stored value, not full type fidelity. */
function parseIndicatorSettings(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const requiredNumeric = ['buyConsensus', 'sellConsensus', 'recencyDays', 'persistenceBars', 'minHoldingDays', 'atrPeriod', 'adxPeriod'];
  if (!requiredNumeric.every((key) => typeof r[key] === 'number' && Number.isFinite(r[key]))) return null;
  const out: Record<string, unknown> = {};
  for (const key of requiredNumeric) out[key] = r[key];
  out.atrMultiplier = typeof r.atrMultiplier === 'number' && Number.isFinite(r.atrMultiplier) ? r.atrMultiplier : undefined;
  out.adxThreshold = typeof r.adxThreshold === 'number' && Number.isFinite(r.adxThreshold) ? r.adxThreshold : undefined;
  return out;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const LOT_ACTIONS = ['buy', 'sell'] as const;

/** Validates a `{ action, tradeDate, shares, price }` lot. shares must be a
 * positive whole number (no fractional shares); price a positive number.
 * Client-side keystroke filtering already discourages bad input, but this
 * is the actual authority (a paste or a direct API call can bypass that). */
function parseLotInput(raw: unknown): LotInput | 'invalid' {
  if (!raw || typeof raw !== 'object') return 'invalid';
  const r = raw as Record<string, unknown>;
  if (typeof r.action !== 'string' || !LOT_ACTIONS.includes(r.action as (typeof LOT_ACTIONS)[number])) return 'invalid';
  if (typeof r.tradeDate !== 'string' || !DATE_PATTERN.test(r.tradeDate) || Number.isNaN(Date.parse(r.tradeDate))) return 'invalid';
  if (typeof r.shares !== 'number' || !Number.isInteger(r.shares) || r.shares <= 0) return 'invalid';
  if (typeof r.price !== 'number' || !Number.isFinite(r.price) || r.price <= 0) return 'invalid';
  return { action: r.action as 'buy' | 'sell', tradeDate: r.tradeDate, shares: r.shares, price: r.price };
}

/** The first ledger row (in trade order) whose running total goes
 * negative, if any: used to build a specific "this would sell more than
 * held as of {date}" message rather than a generic rejection. */
function firstNegativeRow(rows: LedgerRow[]): LedgerRow | undefined {
  return rows.find((row) => row.totalHeldShares < 0);
}

// requireAuth is applied per-route below, not via a blanket `/watchlist/*`
// wildcard; that would also gate the dev-only scheduler-trigger endpoint,
// which is deliberately separate (see bottom of file).

watchlistRoute.get('/watchlist', requireAuth, async (c) => {
  const userId = c.get('userId');
  const entries = await getWatchlist(userId);
  const tickers = entries.map((e) => e.ticker);
  const lastChangedMap = await getLastChangedMap(tickers);
  const entryByTicker = new Map(entries.map((e) => [e.ticker, e]));
  // One query for every ticker's lots, grouped in memory below, instead of
  // fetching per-row inside the Promise.all; mirrors getWatchlist's own
  // one-query-for-the-whole-list shape.
  const lotsByTicker = await getAllPositionLotsForUser(userId);

  const blankRow = (ticker: string, status: WatchlistTickerStatus, lastChangedAt: string | null, entry: WatchlistRow): WatchlistDashboardRow => ({
    ticker, overall: null, computed: null, ai: null, asOf: null, status, lastChangedAt,
    settings: entry.settings, heldShares: 0, sinceDate: null, positionRisk: null, overallOverrideReason: null, unrealizedPnl: null,
  });

  const rows: WatchlistDashboardRow[] = await Promise.all(
    entries.map(async ({ ticker, settings }): Promise<WatchlistDashboardRow> => {
      const entry = entryByTicker.get(ticker)!;
      const lots = lotsByTicker.get(ticker) ?? [];
      const lastChangedAt = lastChangedMap.get(ticker) ?? null;
      const meta = await getCachedReportMeta(ticker);

      // Nothing ever captured for this ticker (or its row is gone).
      if (!meta) return blankRow(ticker, isRunning(ticker) ? 'running' : 'failed', lastChangedAt, entry);

      const report = recomputeReport(meta.report, settings ?? {});
      const computed = report.deterministic?.signal ?? null;
      const ai = report.verdict.signal;
      const currentPrice = report.deterministic?.values.close ?? null;
      const risk = await applyPositionRisk(
        ticker, lots, currentPrice, resolveDualOverall(computed, ai), settings?.atrMultiplier, settings?.atrPeriod,
      );
      const withSignal = {
        ticker,
        overall: risk.overall,
        computed,
        ai,
        asOf: report.deterministic?.asOf ?? null,
        lastChangedAt,
        settings,
        heldShares: risk.heldShares,
        sinceDate: risk.sinceDate,
        positionRisk: risk.positionRisk,
        overallOverrideReason: risk.overallOverrideReason,
        unrealizedPnl: risk.unrealizedPnl,
      };

      if (!meta.stale) return { ...withSignal, status: 'ready' };
      if (isRunning(ticker)) return { ...withSignal, status: 'running' };

      // Stale read on record. If the newest thing that happened for this
      // ticker is a failure more recent than that read, it's a real
      // failure; otherwise it's just old and the next sweep will catch it.
      const failure = await getLatestFailure(ticker);
      const lastAttemptFailed =
        failure !== null && new Date(failure.occurredAt).getTime() > new Date(meta.retrievedAt).getTime();
      return lastAttemptFailed
        ? blankRow(ticker, 'failed', lastChangedAt, entry)
        : { ...withSignal, status: 'stale' };
    }),
  );

  return c.json({ ok: true, rows });
});

watchlistRoute.post('/watchlist', requireAuth, async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json<{ ticker?: string; settings?: unknown }>().catch(() => ({}) as { ticker?: string; settings?: unknown });
  const ticker = parseTicker(body.ticker);
  if (!ticker) return c.json({ ok: false, reason: 'Invalid or missing ticker' }, 400);

  await addToWatchlist(userId, ticker, parseSettings(body.settings));

  // Fire-and-forget: don't make the user wait until tomorrow's 7am sweep
  // for a first result. Not awaited, so this returns immediately; a
  // duplicate/in-flight/already-fresh ticker is cheap thanks to
  // runPipeline's own cache check and queue.
  void runPipeline(ticker);

  return c.json({ ok: true, ticker, pending: true });
});

// Registered before the `:ticker` param routes below so this static path
// can never be shadowed by a ticker literally named "order" (Hono's router
// prioritizes static segments regardless of registration order, but keeping
// the more specific route first is the least surprising to read either way).
watchlistRoute.patch('/watchlist/order', requireAuth, async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json<{ tickers?: unknown }>().catch(() => ({}) as { tickers?: unknown });
  if (!Array.isArray(body.tickers) || !body.tickers.every((t) => typeof t === 'string')) {
    return c.json({ ok: false, reason: 'tickers must be an array of strings' }, 400);
  }

  await reorderWatchlist(userId, body.tickers);
  return c.json({ ok: true });
});

// Whole-watchlist, not per-ticker: one preference per user, independent of
// which tickers are on the list or how many. Registered as a static
// segment alongside /watchlist/order for the same reason that one is:
// keeping the whole-watchlist routes visually grouped, separate from the
// :ticker-scoped ones below (Hono's router itself doesn't care about
// registration order for this — static segments always win).
watchlistRoute.get('/watchlist/notifications', requireAuth, async (c) => {
  const userId = c.get('userId');
  const emailOnSignal = await getEmailOnSignal(userId);
  return c.json({ ok: true, emailOnSignal });
});

watchlistRoute.patch('/watchlist/notifications', requireAuth, async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json<{ emailOnSignal?: unknown }>().catch(() => ({}) as { emailOnSignal?: unknown });
  if (typeof body.emailOnSignal !== 'boolean') {
    return c.json({ ok: false, reason: 'emailOnSignal must be a boolean' }, 400);
  }

  await setEmailOnSignal(userId, body.emailOnSignal);
  return c.json({ ok: true, emailOnSignal: body.emailOnSignal });
});

watchlistRoute.patch('/watchlist/:ticker', requireAuth, async (c) => {
  const userId = c.get('userId');
  const ticker = parseTicker(c.req.param('ticker'));
  if (!ticker) return c.json({ ok: false, reason: 'Invalid ticker' }, 400);

  const body = await c.req
    .json<{ settings?: unknown; scenarioSettings?: unknown }>()
    .catch(() => ({}) as { settings?: unknown; scenarioSettings?: unknown });

  // Both fields are independent and optional: a caller may update either or
  // both in one request. Position lots have their own dedicated routes
  // below (a list, not a single overwrite-able field).
  if (body.settings !== undefined) {
    const settings = parseSettings(body.settings) ?? {};
    await updateWatchlistSettings(userId, ticker, settings);
  }
  if (body.scenarioSettings !== undefined) {
    const scenarioSettings = parseIndicatorSettings(body.scenarioSettings);
    if (!scenarioSettings) return c.json({ ok: false, reason: 'Invalid scenarioSettings' }, 400);
    await updateScenarioSettings(userId, ticker, scenarioSettings);
  }

  return c.json({ ok: true, ticker });
});

watchlistRoute.get('/watchlist/:ticker/report', requireAuth, async (c) => {
  const userId = c.get('userId');
  const ticker = parseTicker(c.req.param('ticker'));
  if (!ticker) return c.json({ ok: false, reason: 'Invalid ticker' }, 400);

  const entries = await getWatchlist(userId);
  const entry = entries.find((e) => e.ticker === ticker);
  if (!entry) return c.json({ ok: false, reason: 'Not on your watchlist' }, 404);

  // A read on record (fresh OR stale) is always shown. The page displays
  // when it was generated and offers a manual refresh; it does not silently
  // re-run on load anymore. A genuinely stale read still gets picked up by
  // the next 7am sweep on its own.
  const detail = await getCachedReportDetail(ticker);
  if (detail) {
    const report = recomputeReport(detail.report, entry.settings ?? {});
    const failure = await getLatestFailure(ticker);
    const computed = report.deterministic?.signal ?? null;
    const ai = report.verdict.signal;
    const currentPrice = report.deterministic?.values.close ?? null;
    const lots = await getPositionLots(userId, ticker);
    const risk = await applyPositionRisk(
      ticker, lots, currentPrice, resolveDualOverall(computed, ai), entry.settings?.atrMultiplier, entry.settings?.atrPeriod,
    );
    return c.json({
      ok: true,
      report,
      settings: entry.settings,
      scenarioSettings: entry.scenarioSettings,
      retrievedAt: detail.retrievedAt,
      stale: detail.stale,
      refreshAvailableAt: computeRefreshAvailableAt(detail.retrievedAt, failure?.occurredAt ?? null),
      overall: risk.overall,
      lots,
      ledgerRows: computeLedger(lots).rows,
      positionRisk: risk.positionRisk,
      overallOverrideReason: risk.overallOverrideReason,
      unrealizedPnl: risk.unrealizedPnl,
    });
  }

  // Nothing ever captured for this ticker: loading the page still kicks off
  // its first capture (rate-limited by the pipeline's own 30s guard).
  if (isRunning(ticker)) {
    return c.json({ ok: false, reason: 'running', pending: true });
  }
  if (canAttempt(ticker)) {
    void runPipeline(ticker); // stamps lastAttemptAt itself
    return c.json({ ok: false, reason: 'running', pending: true });
  }

  // Rate-limited: too soon since the last attempt. Explain what happened
  // last time instead of silently doing nothing.
  const failure = await getLatestFailure(ticker);
  const stage = failure?.stage ?? 'unknown';
  const reason = failure?.reason ?? 'unknown';
  return c.json({
    ok: false,
    pending: false,
    stage,
    reason,
    userMessage: outageMessageFor(stage, reason) ?? undefined,
  });
});

/** This day's `{low, high}` from a fresh 2y bar fetch, or null if there's
 * no trading data for that date (weekend/holiday, or before the ticker's
 * history). Shared by the day-range lookup endpoint and lot save
 * validation below, so both stay consistent about what counts as "no data
 * for that date." */
async function dayRangeFor(ticker: string, date: string): Promise<{ low: number; high: number } | null> {
  const { bars } = await yahooDataSource.fetchDailyBars(ticker, '2y');
  const bar = bars.find((b) => b.date === date);
  return bar ? { low: bar.low, high: bar.high } : null;
}

watchlistRoute.get('/watchlist/:ticker/day-range', requireAuth, async (c) => {
  const ticker = parseTicker(c.req.param('ticker'));
  if (!ticker) return c.json({ ok: false, reason: 'Invalid ticker' }, 400);
  const date = c.req.query('date');
  if (!date || !DATE_PATTERN.test(date)) return c.json({ ok: false, reason: 'Invalid date' }, 400);

  try {
    const range = await dayRangeFor(ticker, date);
    if (!range) return c.json({ ok: false, reason: 'No trading data for that date' });
    return c.json({ ok: true, low: range.low, high: range.high });
  } catch {
    return c.json({ ok: false, reason: 'Could not fetch price data' }, 502);
  }
});

/** Shared by create/edit: validates the day-range and held-shares rules
 * against a candidate full lot list (the caller builds `candidateLots` by
 * inserting or replacing the one lot being saved), returning a rejection
 * reason or null if it's clean to persist. */
async function validateLotSave(ticker: string, tradeDate: string, price: number, candidateLots: PositionLot[]): Promise<string | null> {
  const range = await dayRangeFor(ticker, tradeDate);
  if (!range) return `No trading data found for ${ticker} on ${tradeDate}.`;
  if (price < range.low || price > range.high) {
    return `Entry price must be between $${range.low.toFixed(2)} and $${range.high.toFixed(2)} for ${tradeDate}.`;
  }
  const negative = firstNegativeRow(computeLedger(candidateLots).rows);
  if (negative) {
    return `This would sell more shares than held as of ${negative.lot.tradeDate}.`;
  }
  return null;
}

watchlistRoute.post('/watchlist/:ticker/positions', requireAuth, async (c) => {
  const userId = c.get('userId');
  const ticker = parseTicker(c.req.param('ticker'));
  if (!ticker) return c.json({ ok: false, reason: 'Invalid ticker' }, 400);

  const entries = await getWatchlist(userId);
  if (!entries.some((e) => e.ticker === ticker)) return c.json({ ok: false, reason: 'Not on your watchlist' }, 404);

  const body = await c.req.json<unknown>().catch(() => null);
  const input = parseLotInput(body);
  if (input === 'invalid') return c.json({ ok: false, reason: 'Invalid position input' }, 400);

  const existingLots = await getPositionLots(userId, ticker);
  const pending: PositionLot = { id: 'pending', createdAt: new Date().toISOString(), ...input };
  const rejection = await validateLotSave(ticker, input.tradeDate, input.price, [...existingLots, pending]);
  if (rejection) return c.json({ ok: false, reason: rejection }, 400);

  const inserted = await insertLot(userId, ticker, input);
  if (!inserted) return c.json({ ok: false, reason: 'Could not save position' }, 500);

  const ledger = computeLedger([...existingLots, inserted]);
  return c.json({ ok: true, lots: [...existingLots, inserted], ledgerRows: ledger.rows });
});

watchlistRoute.patch('/watchlist/:ticker/positions/:id', requireAuth, async (c) => {
  const userId = c.get('userId');
  const ticker = parseTicker(c.req.param('ticker'));
  if (!ticker) return c.json({ ok: false, reason: 'Invalid ticker' }, 400);
  const lotId = c.req.param('id');
  if (!lotId) return c.json({ ok: false, reason: 'Invalid position id' }, 400);

  const body = await c.req.json<unknown>().catch(() => null);
  const input = parseLotInput(body);
  if (input === 'invalid') return c.json({ ok: false, reason: 'Invalid position input' }, 400);

  const existingLots = await getPositionLots(userId, ticker);
  if (!existingLots.some((l) => l.id === lotId)) return c.json({ ok: false, reason: 'Position not found' }, 404);

  const candidateLots = existingLots.map((l) => (l.id === lotId ? { ...l, ...input } : l));
  const rejection = await validateLotSave(ticker, input.tradeDate, input.price, candidateLots);
  if (rejection) return c.json({ ok: false, reason: rejection }, 400);

  const ok = await updateLot(userId, ticker, lotId, input);
  if (!ok) return c.json({ ok: false, reason: 'Could not save position' }, 500);

  return c.json({ ok: true, lots: candidateLots, ledgerRows: computeLedger(candidateLots).rows });
});

watchlistRoute.delete('/watchlist/:ticker/positions/:id', requireAuth, async (c) => {
  const userId = c.get('userId');
  const ticker = parseTicker(c.req.param('ticker'));
  if (!ticker) return c.json({ ok: false, reason: 'Invalid ticker' }, 400);
  const lotId = c.req.param('id');
  if (!lotId) return c.json({ ok: false, reason: 'Invalid position id' }, 400);

  const existingLots = await getPositionLots(userId, ticker);
  const remaining = existingLots.filter((l) => l.id !== lotId);
  if (remaining.length === existingLots.length) return c.json({ ok: false, reason: 'Position not found' }, 404);

  const negative = firstNegativeRow(computeLedger(remaining).rows);
  if (negative) {
    return c.json(
      {
        ok: false,
        reason: `This deletion would cause an invalid number of shares to be sold on ${negative.lot.tradeDate}, please modify or remove that value first.`,
      },
      400,
    );
  }

  const ok = await deleteLot(userId, ticker, lotId);
  if (!ok) return c.json({ ok: false, reason: 'Could not delete position' }, 500);

  return c.json({ ok: true, lots: remaining, ledgerRows: computeLedger(remaining).rows });
});

watchlistRoute.delete('/watchlist/:ticker/positions', requireAuth, async (c) => {
  const userId = c.get('userId');
  const ticker = parseTicker(c.req.param('ticker'));
  if (!ticker) return c.json({ ok: false, reason: 'Invalid ticker' }, 400);

  await clearLots(userId, ticker);
  return c.json({ ok: true });
});

watchlistRoute.post('/watchlist/:ticker/refresh', requireAuth, async (c) => {
  const userId = c.get('userId');
  const ticker = parseTicker(c.req.param('ticker'));
  if (!ticker) return c.json({ ok: false, reason: 'Invalid ticker' }, 400);

  const entries = await getWatchlist(userId);
  if (!entries.some((e) => e.ticker === ticker)) {
    return c.json({ ok: false, reason: 'Not on your watchlist' }, 404);
  }

  // Already in flight (a sweep, or another tab's refresh): piggyback, don't
  // reject or start a second run.
  if (isRunning(ticker)) return c.json({ ok: true, pending: true });

  // Enforce the 1h manual-refresh cooldown here too, not just in the UI: a
  // client with a stale button state (or a direct API call) can't bypass it.
  const meta = await getCachedReportMeta(ticker);
  const failure = await getLatestFailure(ticker);
  const availableAt = computeRefreshAvailableAt(meta?.retrievedAt ?? null, failure?.occurredAt ?? null);
  if (availableAt) {
    return c.json({ ok: false, reason: 'cooldown', refreshAvailableAt: availableAt }, 429);
  }

  // force: the user may be refreshing a read that's under 24h old (past the
  // 1h cooldown but still "fresh" to the cache); without force this would
  // just hand back the cached copy and do nothing.
  void runPipeline(ticker, { force: true });
  return c.json({ ok: true, pending: true });
});

watchlistRoute.delete('/watchlist/:ticker', requireAuth, async (c) => {
  const userId = c.get('userId');
  const ticker = parseTicker(c.req.param('ticker'));
  if (!ticker) return c.json({ ok: false, reason: 'Invalid ticker' }, 400);

  await removeFromWatchlist(userId, ticker);
  return c.json({ ok: true });
});

// Not behind requireAuth (it sweeps every user's tickers, not one caller's)
// and gated separately so it can't run in production by accident; exists
// purely so the scheduler can be verified without waiting for a real 7am ET.
if (process.env.ENABLE_DEV_ENDPOINTS === 'true') {
  watchlistRoute.post('/watchlist/dev/run-scheduler-now', async (c) => {
    await runDailyWatchlistJobAndNotify();
    return c.json({ ok: true });
  });
}
