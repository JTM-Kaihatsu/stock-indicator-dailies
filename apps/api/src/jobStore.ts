import { randomUUID } from 'node:crypto';

/**
 * Generic in-memory background job store. Extracted from jobs.ts (which was
 * hard-coupled to the daily pipeline's DailyResult) so the advisor endpoint
 * can reuse the same TTL/Map/UUID mechanics for a different result type,
 * without copy-pasting them.
 *
 * In-memory, not Supabase-backed: the API runs as a single long-lived Render
 * instance (not serverless/horizontally-scaled), and a job only needs to
 * survive the seconds-to-minutes a client actually polls it.
 */

/** `stage` is an optional human-readable "here's what's happening right
 * now" string a still-running job can update via the `reportStage` callback
 * `start()` hands its `run` function; a job that never calls it (e.g. the
 * daily pipeline) simply stays undefined, same as before this field
 * existed. */
export type Job<T> = { status: 'pending'; stage?: string } | { status: 'done'; result: T };

export interface JobStore<T> {
  /** Starts `run(reportStage)` in the background; returns immediately with
   * a job id. `onError` maps a thrown error to the result value stored for
   * the job (rather than losing the failure entirely). `run` can ignore
   * the `reportStage` argument entirely if it has nothing granular to
   * report. */
  start(run: (reportStage: (stage: string) => void) => Promise<T>, onError: (err: unknown) => T): string;
  get(id: string): Job<T> | undefined;
}

export function createJobStore<T>(ttlMs = 5 * 60 * 1000): JobStore<T> {
  const jobs = new Map<string, Job<T> & { createdAt: number }>();

  function pruneExpired(): void {
    const cutoff = Date.now() - ttlMs;
    for (const [id, job] of jobs) {
      if (job.createdAt < cutoff) jobs.delete(id);
    }
  }

  return {
    start(run, onError) {
      pruneExpired();
      const id = randomUUID();
      const createdAt = Date.now();
      jobs.set(id, { status: 'pending', createdAt });

      const reportStage = (stage: string) => {
        const existing = jobs.get(id);
        // No-ops once the job has finished; a stray report racing the
        // final .then/.catch below shouldn't resurrect a done job as
        // pending.
        if (existing?.status === 'pending') {
          jobs.set(id, { status: 'pending', stage, createdAt: existing.createdAt });
        }
      };

      run(reportStage)
        .then((result) => {
          jobs.set(id, { status: 'done', result, createdAt: Date.now() });
        })
        .catch((err: unknown) => {
          jobs.set(id, { status: 'done', result: onError(err), createdAt: Date.now() });
        });

      return id;
    },
    get(id) {
      const job = jobs.get(id);
      if (!job) return undefined;
      return job.status === 'pending' ? { status: 'pending', stage: job.stage } : job;
    },
  };
}
