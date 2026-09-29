import type { DailyResult } from '@stock-indicator-dailies/daily';

import { createJobStore } from './jobStore.ts';
import { runPipeline } from './pipeline.ts';

/**
 * Render's own gateway times out requests around ~30s, well short of the
 * pipeline's typical 15-30s+ runtime; a blocking HTTP call can't reliably
 * outrun that. Instead, `/daily/start` kicks off the run here and returns
 * immediately with a job id; the client polls `/daily/jobs/:id` (each poll
 * is fast, never close to any gateway timeout) until it reports done.
 *
 * TTL is longer than the default 5 minutes: the pipeline serializes on a
 * single browser session (see pipeline.ts), so a request queued behind
 * others, plus a slow capture, can legitimately take a while. The job must
 * outlive the client's own poll timeout (see lib/polling.ts) or a still-
 * running job gets pruned out from under a client still waiting on it.
 */
const store = createJobStore<DailyResult>(6 * 60 * 1000);

/** Starts a pipeline run in the background; returns immediately with a job
 * id. `force`, when true, bypasses the cache-freshness check the same way
 * the daily sweep and a watchlisted ticker's manual refresh already do (see
 * pipeline.ts's RunPipelineOptions); used by the ad-hoc refresh route. */
export function startJob(ticker: string, options: { force?: boolean } = {}): string {
  return store.start(
    () => runPipeline(ticker, { force: options.force }),
    (err) => ({
      ok: false,
      stage: 'capture',
      reason: 'unknown',
      errors: [err instanceof Error ? err.message : String(err)],
      timings: { captureMs: 0, analyzeMs: 0, deterministicMs: 0, totalMs: 0, withinTarget: false },
    }),
  );
}

export function getJob(id: string) {
  return store.get(id);
}
