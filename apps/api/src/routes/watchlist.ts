import { Hono } from 'hono';
import { recomputeReport, resolveDualOverall, type DeriveSignalOptions, type Signal } from '@stock-indicator-dailies/shared';

import { getCachedReport } from '../cache.ts';
import { runPipeline } from '../pipeline.ts';
import { parseTicker } from '../ticker.ts';
import { addToWatchlist, getWatchlist, removeFromWatchlist, updateWatchlistSettings } from '../watchlist.ts';
import { requireAuth } from '../authMiddleware.ts';
import { runDailyWatchlistJob } from '../scheduler.ts';
import { getLastChangedMap } from '../signalHistory.ts';

export const watchlistRoute = new Hono();

export interface WatchlistDashboardRow {
  ticker: string;
  overall: Signal | null;
  computed: Signal | null;
  ai: Signal | null;
  asOf: string | null;
  pending: boolean;
  /** Since when the Overall signal has held its current value; null if
   * there's no history yet (e.g. still pending its first capture). */
  lastChangedAt: string | null;
  /** This ticker's sensitivity override; null means app defaults. */
  settings: DeriveSignalOptions | null;
}

/** Picks out only the 3 recognized numeric fields, dropping anything else
 * and any non-finite value. Not a full schema validator; a malformed field
 * degrading to "unset" (app default) is an acceptable failure mode here. */
function parseSettings(raw: unknown): DeriveSignalOptions | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const out: DeriveSignalOptions = {};
  if (typeof r.buyConsensus === 'number' && Number.isFinite(r.buyConsensus)) out.buyConsensus = r.buyConsensus;
  if (typeof r.sellConsensus === 'number' && Number.isFinite(r.sellConsensus)) out.sellConsensus = r.sellConsensus;
  if (typeof r.recencyDays === 'number' && Number.isFinite(r.recencyDays)) out.recencyDays = r.recencyDays;
  return Object.keys(out).length > 0 ? out : null;
}

// requireAuth is applied per-route below, not via a blanket `/watchlist/*`
// wildcard; that would also gate the dev-only scheduler-trigger endpoint,
// which is deliberately separate (see bottom of file).

watchlistRoute.get('/watchlist', requireAuth, async (c) => {
  const userId = c.get('userId');
  const entries = await getWatchlist(userId);
  const tickers = entries.map((e) => e.ticker);
  const lastChangedMap = await getLastChangedMap(tickers);

  const rows: WatchlistDashboardRow[] = await Promise.all(
    entries.map(async ({ ticker, settings }): Promise<WatchlistDashboardRow> => {
      const lastChangedAt = lastChangedMap.get(ticker) ?? null;
      const cached = await getCachedReport(ticker);
      if (!cached) {
        return { ticker, overall: null, computed: null, ai: null, asOf: null, pending: true, lastChangedAt, settings };
      }
      const report = recomputeReport(cached, settings ?? {});
      const computed = report.deterministic?.signal ?? null;
      const ai = report.verdict.signal;
      return {
        ticker,
        overall: resolveDualOverall(computed, ai),
        computed,
        ai,
        asOf: report.deterministic?.asOf ?? null,
        pending: false,
        lastChangedAt,
        settings,
      };
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

watchlistRoute.patch('/watchlist/:ticker', requireAuth, async (c) => {
  const userId = c.get('userId');
  const ticker = parseTicker(c.req.param('ticker'));
  if (!ticker) return c.json({ ok: false, reason: 'Invalid ticker' }, 400);

  const body = await c.req.json<{ settings?: unknown }>().catch(() => ({}) as { settings?: unknown });
  const settings = parseSettings(body.settings) ?? {};
  await updateWatchlistSettings(userId, ticker, settings);

  return c.json({ ok: true, ticker, settings });
});

watchlistRoute.get('/watchlist/:ticker/report', requireAuth, async (c) => {
  const userId = c.get('userId');
  const ticker = parseTicker(c.req.param('ticker'));
  if (!ticker) return c.json({ ok: false, reason: 'Invalid ticker' }, 400);

  const entries = await getWatchlist(userId);
  const entry = entries.find((e) => e.ticker === ticker);
  if (!entry) return c.json({ ok: false, reason: 'Not on your watchlist' }, 404);

  const cached = await getCachedReport(ticker);
  if (!cached) return c.json({ ok: false, reason: 'pending', pending: true });

  const report = recomputeReport(cached, entry.settings ?? {});
  return c.json({ ok: true, report, settings: entry.settings });
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
    await runDailyWatchlistJob();
    return c.json({ ok: true });
  });
}
