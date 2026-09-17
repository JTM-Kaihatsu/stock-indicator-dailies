import { Hono } from 'hono';
import type { RiskTolerance } from '@stock-indicator-dailies/advisor';

import { getCachedSuggestion } from '../advisorCache.ts';
import { getAdvisorJob, startAdvisorJob } from '../advisorJobs.ts';
import { parseTicker } from '../ticker.ts';

export const advisor = new Hono();

const RISK_TOLERANCES: readonly RiskTolerance[] = ['averse', 'neutral', 'seeking'];

/** Defaults to 'neutral' for a caller that doesn't send one yet (kept
 * backward compatible on purpose: the web UI's risk-tolerance selector
 * ships in a follow-up change, and this endpoint needs to keep working
 * for the version of the frontend that predates it). Anything present but
 * not one of the three values is rejected, not silently defaulted. */
function parseRiskTolerance(raw: unknown): RiskTolerance | undefined {
  if (raw === undefined || raw === null) return 'neutral';
  return RISK_TOLERANCES.includes(raw as RiskTolerance) ? (raw as RiskTolerance) : undefined;
}

advisor.post('/advisor/start', async (c) => {
  const body = await c.req.json<{ ticker?: string; riskTolerance?: unknown }>().catch(() => ({}) as { ticker?: string; riskTolerance?: unknown });
  const ticker = parseTicker(body.ticker);
  if (!ticker) {
    return c.json({ ok: false, reason: 'Invalid or missing ticker' }, 400);
  }
  const riskTolerance = parseRiskTolerance(body.riskTolerance);
  if (!riskTolerance) {
    return c.json({ ok: false, reason: 'riskTolerance must be one of averse, neutral, seeking' }, 400);
  }

  // A cache hit resolves immediately, inline; a miss kicks off a fresh
  // job (which may itself skip straight to scoring if research for this
  // ticker is already cached; see advisorJobs.ts). Same cache-hit-inline
  // shape as /daily/start, mainly to avoid repeated slow, web-search-backed
  // calls during testing and demos.
  const cached = await getCachedSuggestion(ticker, riskTolerance);
  if (cached) return c.json({ ok: true, result: cached });

  const jobId = startAdvisorJob(ticker, riskTolerance);
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
  const riskTolerance = parseRiskTolerance(c.req.query('riskTolerance'));
  if (!riskTolerance) {
    return c.json({ ok: false, reason: 'riskTolerance must be one of averse, neutral, seeking' }, 400);
  }

  const cached = await getCachedSuggestion(ticker, riskTolerance);
  return c.json({ ok: true, result: cached });
});
