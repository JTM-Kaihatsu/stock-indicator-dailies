import { Hono } from 'hono';

import { getCachedAdvice } from '../advisorCache.ts';
import { getAdvisorJob, startAdvisorJob } from '../advisorJobs.ts';
import { parseTicker } from '../ticker.ts';

export const advisor = new Hono();

advisor.post('/advisor/start', async (c) => {
  const body = await c.req.json<{ ticker?: string }>().catch(() => ({}) as { ticker?: string });
  const ticker = parseTicker(body.ticker);
  if (!ticker) {
    return c.json({ ok: false, reason: 'Invalid or missing ticker' }, 400);
  }

  // A cache hit resolves immediately, inline; a miss kicks off a fresh
  // research job. Same cache-hit-inline shape as /daily/start, mainly to
  // avoid repeated slow, web-search-backed calls during testing and demos.
  const cached = await getCachedAdvice(ticker);
  if (cached) return c.json({ ok: true, result: cached });

  const jobId = startAdvisorJob(ticker);
  return c.json({ ok: true, jobId });
});

advisor.get('/advisor/jobs/:id', (c) => {
  const job = getAdvisorJob(c.req.param('id'));
  if (!job) return c.json({ status: 'not-found' }, 404);
  return c.json(job);
});

// Read-only peek at a cached suggestion, never triggers fresh research. Lets
// the AI Suggestion panel show a prior result by default on page load; a
// miss just means "nothing to show yet," not an error.
advisor.get('/advisor/cached/:ticker', async (c) => {
  const ticker = parseTicker(c.req.param('ticker'));
  if (!ticker) return c.json({ ok: false, reason: 'Invalid ticker' }, 400);

  const cached = await getCachedAdvice(ticker);
  return c.json({ ok: true, result: cached });
});
