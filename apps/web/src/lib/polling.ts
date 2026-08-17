export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface PollOptions {
  intervalMs?: number;
  /** Generous ceiling; guards against polling forever if something
   * server-side genuinely never resolves a job. */
  maxMs?: number;
}

type PollStatus<T> = { status: 'pending' } | { status: 'done'; result: T } | { status: 'not-found' };

/** Shared poll-until-done loop for any start→jobId→poll flow (used by both
 * the daily analysis and the AI suggestion jobs). Throws on timeout or a
 * not-found job rather than returning a sentinel, so each caller maps the
 * failure into whatever shape its own result type expects. */
export async function pollUntilDone<T>(
  poll: () => Promise<PollStatus<T>>,
  options: PollOptions = {},
): Promise<T> {
  const intervalMs = options.intervalMs ?? 2000;
  const maxMs = options.maxMs ?? 3 * 60 * 1000;
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    await sleep(intervalMs);
    const status = await poll();
    if (status.status === 'done') return status.result;
    if (status.status === 'not-found') throw new Error('Job expired or was never created');
    // status.status === 'pending'; keep polling
  }
  throw new Error('Timed out waiting for the job to finish');
}
