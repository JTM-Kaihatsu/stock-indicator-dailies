import { randomUUID } from 'node:crypto';
import type { DailyResult } from '@stock-indicator-dailies/daily';

import { runPipeline } from './pipeline.ts';

/**
 * In-memory background job store for pipeline runs.
 *
 * Render's own gateway times out requests around ~30s, well short of the
 * pipeline's typical 15-30s+ runtime — a blocking HTTP call can't reliably
 * outrun that. Instead, `/daily/start` kicks off the run here and returns
 * immediately with a job id; the client polls `/daily/jobs/:id` (each poll
 * is fast, never close to any gateway timeout) until it reports done.
 *
 * In-memory, not Supabase-backed: the API runs as a single long-lived Render
 * instance (not serverless/horizontally-scaled), and a job only needs to
 * survive the few seconds to minutes a client polls it — no durability
 * requirement past that.
 */

type Job = { status: 'pending' } | { status: 'done'; result: DailyResult };

const jobs = new Map<string, Job & { createdAt: number }>();

/** Jobs older than this are swept on the next `startJob` call. Generous
 * relative to any realistic poll window, just bounds memory growth. */
const JOB_TTL_MS = 5 * 60 * 1000;

function pruneExpired(): void {
  const cutoff = Date.now() - JOB_TTL_MS;
  for (const [id, job] of jobs) {
    if (job.createdAt < cutoff) jobs.delete(id);
  }
}

/** Starts a pipeline run in the background; returns immediately with a job id. */
export function startJob(ticker: string): string {
  pruneExpired();
  const id = randomUUID();
  jobs.set(id, { status: 'pending', createdAt: Date.now() });

  runPipeline(ticker)
    .then((result) => {
      jobs.set(id, { status: 'done', result, createdAt: Date.now() });
    })
    .catch((err: unknown) => {
      jobs.set(id, {
        status: 'done',
        createdAt: Date.now(),
        result: {
          ok: false,
          stage: 'capture',
          reason: 'unknown',
          errors: [err instanceof Error ? err.message : String(err)],
          timings: { captureMs: 0, analyzeMs: 0, deterministicMs: 0, totalMs: 0, withinTarget: false },
        },
      });
    });

  return id;
}

export function getJob(id: string): Job | undefined {
  const job = jobs.get(id);
  if (!job) return undefined;
  return job.status === 'pending' ? { status: 'pending' } : job;
}
