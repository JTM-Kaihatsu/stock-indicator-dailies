import { Hono } from 'hono';

import { getCachedReport } from '../cache.ts';
import { getJob, startJob } from '../jobs.ts';
import { pendingCount } from '../pipeline.ts';
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

daily.get('/daily/jobs/:id', (c) => {
  const job = getJob(c.req.param('id'));
  if (!job) return c.json({ status: 'not-found' }, 404);
  return c.json(job);
});
