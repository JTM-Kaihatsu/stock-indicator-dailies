import type { DailyResult, DailyTimings, JobStatusResponse, StartResponse } from '@/types/api';
import { pollUntilDone } from './polling.ts';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '';

export function apiUrl(path: string): string {
  return API_BASE ? `${API_BASE}${path}` : path;
}

function emptyTimings(): DailyTimings {
  return { captureMs: 0, analyzeMs: 0, deterministicMs: 0, totalMs: 0, withinTarget: false };
}

function failure(reason: string, userMessage?: string): DailyResult {
  return { ok: false, stage: 'capture', reason, errors: [reason], ...(userMessage ? { userMessage } : {}), timings: emptyTimings() };
}

const POLL_TIMEOUT_MESSAGE = 'Timed out waiting for the job to finish';

/**
 * Kicks off analysis and resolves once it's done; a cache hit resolves
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
    const message = err instanceof Error ? err.message : 'Polling failed';
    // The pipeline serializes on a single browser session, so a slow or
    // queued run can outlast even this generous a client-side wait without
    // ever actually failing server-side; the job may finish moments later.
    const userMessage =
      message === POLL_TIMEOUT_MESSAGE
        ? "This is taking longer than usual, so we stopped waiting; the analysis may still finish in the background. Try the same ticker again in a minute; it'll load instantly if it already completed."
        : undefined;
    return failure(message, userMessage);
  }
}
