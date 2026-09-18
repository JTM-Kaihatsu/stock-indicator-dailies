import { Hono } from 'hono';
import { outageMessageFor, recomputeReport, resolveDualOverall, type DeriveSignalOptions, type RiskTolerance, type Signal } from '@stock-indicator-dailies/shared';

import { getCachedReportDetail, getCachedReportMeta, getLatestFailure } from '../cache.ts';
import { canAttempt, isRunning, runPipeline } from '../pipeline.ts';
import { computeRefreshAvailableAt } from '../refreshCooldown.ts';
import { parseTicker } from '../ticker.ts';
import { addToWatchlist, getWatchlist, removeFromWatchlist, reorderWatchlist, updateScenarioSettings, updateWatchlistSettings } from '../watchlist.ts';
import { requireAuth } from '../authMiddleware.ts';
import { runDailyWatchlistJobAndNotify } from '../scheduler.ts';
import { getLastChangedMap } from '../signalHistory.ts';
import { getEmailOnSignal, setEmailOnSignal } from '../notificationPrefs.ts';

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
}

const RISK_TOLERANCES: readonly RiskTolerance[] = ['averse', 'neutral', 'seeking'];

/** Picks out only the 4 recognized fields, dropping anything else and any
 * invalid value. Not a full schema validator; a malformed field degrading
 * to "unset" (app default) is an acceptable failure mode here. */
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

// requireAuth is applied per-route below, not via a blanket `/watchlist/*`
// wildcard; that would also gate the dev-only scheduler-trigger endpoint,
// which is deliberately separate (see bottom of file).

watchlistRoute.get('/watchlist', requireAuth, async (c) => {
  const userId = c.get('userId');
  const entries = await getWatchlist(userId);
  const tickers = entries.map((e) => e.ticker);
  const lastChangedMap = await getLastChangedMap(tickers);

  const blankRow = (ticker: string, status: WatchlistTickerStatus, lastChangedAt: string | null, settings: DeriveSignalOptions | null): WatchlistDashboardRow => ({
    ticker, overall: null, computed: null, ai: null, asOf: null, status, lastChangedAt, settings,
  });

  const rows: WatchlistDashboardRow[] = await Promise.all(
    entries.map(async ({ ticker, settings }): Promise<WatchlistDashboardRow> => {
      const lastChangedAt = lastChangedMap.get(ticker) ?? null;
      const meta = await getCachedReportMeta(ticker);

      // Nothing ever captured for this ticker (or its row is gone).
      if (!meta) return blankRow(ticker, isRunning(ticker) ? 'running' : 'failed', lastChangedAt, settings);

      const report = recomputeReport(meta.report, settings ?? {});
      const computed = report.deterministic?.signal ?? null;
      const ai = report.verdict.signal;
      const withSignal = {
        ticker,
        overall: resolveDualOverall(computed, ai),
        computed,
        ai,
        asOf: report.deterministic?.asOf ?? null,
        lastChangedAt,
        settings,
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
        ? blankRow(ticker, 'failed', lastChangedAt, settings)
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

  const body = await c.req.json<{ settings?: unknown; scenarioSettings?: unknown }>().catch(() => ({}) as { settings?: unknown; scenarioSettings?: unknown });

  // Both fields are independent and optional: a caller may update just the
  // live sensitivity override, just the scenario/custom backtest settings,
  // or both in one request.
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
    return c.json({
      ok: true,
      report,
      settings: entry.settings,
      scenarioSettings: entry.scenarioSettings,
      retrievedAt: detail.retrievedAt,
      stale: detail.stale,
      refreshAvailableAt: computeRefreshAvailableAt(detail.retrievedAt, failure?.occurredAt ?? null),
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
