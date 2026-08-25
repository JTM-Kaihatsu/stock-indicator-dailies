import { Hono } from 'hono';
import { resolveDualOverall, type Signal } from '@stock-indicator-dailies/shared';

import { getCachedReport } from '../cache.ts';
import { runPipeline } from '../pipeline.ts';
import { parseTicker } from '../ticker.ts';
import { addToWatchlist, getWatchlist, removeFromWatchlist } from '../watchlist.ts';
import { requireAuth } from '../authMiddleware.ts';
import { runDailyWatchlistJob } from '../scheduler.ts';

export const watchlistRoute = new Hono();

export interface WatchlistDashboardRow {
  ticker: string;
  overall: Signal | null;
  computed: Signal | null;
  ai: Signal | null;
  asOf: string | null;
  pending: boolean;
}

// requireAuth is applied per-route below, not via a blanket `/watchlist/*`
// wildcard; that would also gate the dev-only scheduler-trigger endpoint,
// which is deliberately separate (see bottom of file).

watchlistRoute.get('/watchlist', requireAuth, async (c) => {
  const userId = c.get('userId');
  const entries = await getWatchlist(userId);

  const rows: WatchlistDashboardRow[] = await Promise.all(
    entries.map(async ({ ticker }): Promise<WatchlistDashboardRow> => {
      const report = await getCachedReport(ticker);
      if (!report) {
        return { ticker, overall: null, computed: null, ai: null, asOf: null, pending: true };
      }
      const computed = report.deterministic?.signal ?? null;
      const ai = report.verdict.signal;
      return {
        ticker,
        overall: resolveDualOverall(computed, ai),
        computed,
        ai,
        asOf: report.deterministic?.asOf ?? null,
        pending: false,
      };
    }),
  );

  return c.json({ ok: true, rows });
});

watchlistRoute.post('/watchlist', requireAuth, async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json<{ ticker?: string }>().catch(() => ({}) as { ticker?: string });
  const ticker = parseTicker(body.ticker);
  if (!ticker) return c.json({ ok: false, reason: 'Invalid or missing ticker' }, 400);

  await addToWatchlist(userId, ticker);

  // Fire-and-forget: don't make the user wait until tomorrow's 7am sweep
  // for a first result. Not awaited, so this returns immediately; a
  // duplicate/in-flight/already-fresh ticker is cheap thanks to
  // runPipeline's own cache check and queue.
  void runPipeline(ticker);

  return c.json({ ok: true, ticker, pending: true });
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
