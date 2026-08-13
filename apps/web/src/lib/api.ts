import type { DailyResult, DailyTimings, JobStatusResponse, StartResponse } from '@/types/api';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '';
const POLL_INTERVAL_MS = 2000;
// Generous ceiling relative to a normal ~15-30s run — guards against polling
// forever if something server-side genuinely never resolves a job.
const MAX_POLL_MS = 3 * 60 * 1000;

function apiUrl(path: string): string {
  return API_BASE ? `${API_BASE}${path}` : path;
}

function emptyTimings(): DailyTimings {
  return { captureMs: 0, analyzeMs: 0, deterministicMs: 0, totalMs: 0, withinTarget: false };
}

function failure(reason: string): DailyResult {
  return { ok: false, stage: 'capture', reason, errors: [reason], timings: emptyTimings() };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Kicks off analysis and resolves once it's done — a cache hit resolves
 * immediately, a miss polls a background job. No single HTTP request stays
 * open for the pipeline's full duration, so this can't hit a gateway timeout
 * the way a single blocking call could.
 */
export async function analyzeDaily(ticker: string): Promise<DailyResult> {
  const startRes = await fetch(apiUrl('/api/daily/start'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticker }),
  });
  const start: StartResponse = await startRes.json();

  if (!start.ok) return failure(start.reason);
  if ('report' in start) return { ok: true, report: start.report };

  const jobId = start.jobId;
  const deadline = Date.now() + MAX_POLL_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    const statusRes = await fetch(apiUrl(`/api/daily/jobs/${jobId}`));
    const status: JobStatusResponse = await statusRes.json();
    if (status.status === 'done') return status.result;
    if (status.status === 'not-found') return failure('Job expired or was never created');
    // status.status === 'pending' — keep polling
  }
  return failure('Timed out waiting for the analysis to finish');
}
