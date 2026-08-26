import type { AdvisorJobResult, AdvisorJobStatusResponse, AdvisorProposal, StartAdvisorResponse } from '@/types/advisor';
import { apiUrl } from './api.ts';
import { pollUntilDone } from './polling.ts';

/** Thrown by requestAiSuggestion on any failure. Carries `outage` so the UI
 * can decide whether to show a longer retry cooldown and point at Claude's
 * status pages, versus a shorter cooldown for a plain/unclassified failure. */
export class AdvisorRequestError extends Error {
  readonly outage: boolean;
  constructor(message: string, outage: boolean) {
    super(message);
    this.name = 'AdvisorRequestError';
    this.outage = outage;
  }
}

/** Same start→poll shape as analyzeDaily: a cache hit resolves immediately,
 * a miss polls a background research job. */
export async function requestAiSuggestion(ticker: string): Promise<AdvisorProposal> {
  const startRes = await fetch(apiUrl('/api/advisor/start'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticker }),
  });
  const start: StartAdvisorResponse = await startRes.json();
  if (!start.ok) throw new AdvisorRequestError(start.reason, false);
  if ('result' in start) return start.result;

  let jobResult: AdvisorJobResult;
  try {
    jobResult = await pollUntilDone<AdvisorJobResult>(async () => {
      const statusRes = await fetch(apiUrl(`/api/advisor/jobs/${start.jobId}`));
      return (await statusRes.json()) as AdvisorJobStatusResponse;
    });
  } catch (err) {
    // A client-side poll timeout isn't itself evidence of a Claude outage;
    // the research may just be slow. Shorter cooldown, no status-page hint.
    throw new AdvisorRequestError(err instanceof Error ? err.message : 'Polling failed', false);
  }

  if (!jobResult.ok) throw new AdvisorRequestError(jobResult.reason, jobResult.outage);
  return jobResult.result;
}

/** Read-only peek at a cached suggestion for `ticker`; never triggers fresh
 * research. `null` on a miss or any failure — a caller uses this only to
 * seed a default display, so there's nothing actionable in an error here. */
export async function fetchCachedAdvice(ticker: string): Promise<AdvisorProposal | null> {
  try {
    const res = await fetch(apiUrl(`/api/advisor/cached/${encodeURIComponent(ticker)}`));
    const data: { ok: boolean; result?: AdvisorProposal | null } = await res.json();
    return data.ok ? (data.result ?? null) : null;
  } catch {
    return null;
  }
}
