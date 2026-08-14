import type { DailyResult, DailyTimings, JobStatusResponse, StartResponse } from '@/types/api';
import { pollUntilDone } from './polling.ts';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '';

export function apiUrl(path: string): string {
  return API_BASE ? `${API_BASE}${path}` : path;
}

function emptyTimings(): DailyTimings {
  return { captureMs: 0, analyzeMs: 0, deterministicMs: 0, totalMs: 0, withinTarget: false };
}

function failure(reason: string): DailyResult {
  return { ok: false, stage: 'capture', reason, errors: [reason], timings: emptyTimings() };
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

  try {
    return await pollUntilDone<DailyResult>(async () => {
      const statusRes = await fetch(apiUrl(`/api/daily/jobs/${start.jobId}`));
      return (await statusRes.json()) as JobStatusResponse;
    });
  } catch (err) {
    return failure(err instanceof Error ? err.message : 'Polling failed');
  }
}
