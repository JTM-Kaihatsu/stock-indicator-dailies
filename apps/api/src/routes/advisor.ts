import { Hono } from 'hono';

import { getAdvisorJob, startAdvisorJob } from '../advisorJobs.ts';

export const advisor = new Hono();

const TICKER_PATTERN = /^[A-Z]{1,5}(\.[A-Z]{1,2})?$/;

advisor.post('/advisor/start', async (c) => {
  const body = await c.req.json<{ ticker?: string }>().catch(() => ({}) as { ticker?: string });
  const ticker = body.ticker?.trim().toUpperCase();
  if (!ticker || !TICKER_PATTERN.test(ticker)) {
    return c.json({ ok: false, reason: 'Invalid or missing ticker' }, 400);
  }

  // No cache-hit-inline path (unlike /daily/start) — every suggestion is a
  // fresh research call by design.
  const jobId = startAdvisorJob(ticker);
  return c.json({ ok: true, jobId });
});

advisor.get('/advisor/jobs/:id', (c) => {
  const job = getAdvisorJob(c.req.param('id'));
  if (!job) return c.json({ status: 'not-found' }, 404);
  return c.json(job);
});
