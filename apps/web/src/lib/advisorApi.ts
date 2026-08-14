import type { AdvisorJobResult, AdvisorJobStatusResponse, AdvisorProposal, StartAdvisorResponse } from '@/types/advisor';
import { apiUrl } from './api.ts';
import { pollUntilDone } from './polling.ts';

/** Same start→poll shape as analyzeDaily, but every call is a fresh
 * research request; no cache-hit-inline path on this one. */
export async function requestAiSuggestion(ticker: string): Promise<AdvisorProposal> {
  const startRes = await fetch(apiUrl('/api/advisor/start'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticker }),
  });
  const start: StartAdvisorResponse = await startRes.json();
  if (!start.ok) throw new Error(start.reason);

  const jobResult = await pollUntilDone<AdvisorJobResult>(async () => {
    const statusRes = await fetch(apiUrl(`/api/advisor/jobs/${start.jobId}`));
    return (await statusRes.json()) as AdvisorJobStatusResponse;
  });

  if (!jobResult.ok) throw new Error(jobResult.reason);
  return jobResult.result;
}
