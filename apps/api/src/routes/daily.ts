import { Hono } from 'hono';

import { getCachedReport } from '../cache.ts';
import { getJob, startJob } from '../jobs.ts';
import { pendingCount } from '../pipeline.ts';
import { checkRefreshCooldown, proactiveRefreshAvailableAt } from '../refreshCooldown.ts';
import { parseTicker } from '../ticker.ts';

export const daily = new Hono();

daily.get('/health', (c) => c.json({ ok: true, pending: pendingCount() }));

daily.post('/daily/start', async (c) => {
  const body = await c.req.json<{ ticker?: string }>().catch(() => ({}) as { ticker?: string });
  const ticker = parseTicker(body.ticker);
  if (!ticker) return c.json({ ok: false, reason: 'Invalid or missing ticker' }, 400);

  // A cache hit resolves immediately, inline; no job, no polling, no risk
  // of any gateway timeout, since this returns in well under a second.
  const cached = await getCachedReport(ticker);
  if (cached) return c.json({ ok: true, report: cached });

  const jobId = startJob(ticker);
  return c.json({ ok: true, jobId });
});

/** The ad-hoc lookup page's own refresh action, for a ticker that isn't
 * necessarily on anyone's watchlist. Deliberately not behind requireAuth:
 * unlike the watchlist's own /watchlist/:ticker/refresh (which adds an "is
 * this on your list" check on top), this cooldown is entirely ticker-scoped
 * already (see checkRefreshCooldown), so there's no per-user state to gate
 * on here -- the same 1h rule applies equally to every caller looking up
 * this ticker, watchlisted or not. Job-based (like /daily/start) rather
 * than watchlist's fire-and-forget + poll-the-report-endpoint pattern,
 * since the ad-hoc page already has job-polling infrastructure and no
 * per-user report endpoint to poll instead. */
daily.post('/daily/:ticker/refresh', async (c) => {
  const ticker = parseTicker(c.req.param('ticker'));
  if (!ticker) return c.json({ ok: false, reason: 'Invalid ticker' }, 400);

  const refreshAvailableAt = await checkRefreshCooldown(ticker);
  if (refreshAvailableAt) {
    return c.json({ ok: false, reason: 'cooldown', refreshAvailableAt }, 429);
  }

  const jobId = startJob(ticker, { force: true });
  // The cooldown itself only becomes visible once this job's capture
  // actually lands (chart_cache.retrieved_at moves); a client polling
  // checkRefreshCooldown again right now would still see "available".
  // Returning the resulting window proactively lets the frontend disable
  // the button and show a countdown immediately, without needing to
  // duplicate this logic as a second copy of its own. Accounts for the
  // market-hours guardrail too (see proactiveRefreshAvailableAt): a
  // refresh kicked off after a close shows the real next-open wait right
  // away, not a flat "+1h" the very next real check would contradict.
  return c.json({ ok: true, jobId, refreshAvailableAt: proactiveRefreshAvailableAt() });
});

daily.get('/daily/jobs/:id', (c) => {
  const job = getJob(c.req.param('id'));
  if (!job) return c.json({ status: 'not-found' }, 404);
  return c.json(job);
});
