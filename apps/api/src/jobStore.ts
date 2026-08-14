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

export type Job<T> = { status: 'pending' } | { status: 'done'; result: T };

export interface JobStore<T> {
  /** Starts `run()` in the background; returns immediately with a job id.
   * `onError` maps a thrown error to the result value stored for the job
   * (rather than losing the failure entirely). */
  start(run: () => Promise<T>, onError: (err: unknown) => T): string;
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
      jobs.set(id, { status: 'pending', createdAt: Date.now() });

      run()
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
      return job.status === 'pending' ? { status: 'pending' } : job;
    },
  };
}
