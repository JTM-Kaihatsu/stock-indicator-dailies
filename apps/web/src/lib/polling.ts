export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface PollOptions {
  intervalMs?: number;
  /**
   * Generous ceiling; guards against polling forever if something
   * server-side genuinely never resolves a job. The daily pipeline runs on
   * a single serialized browser session (see apps/api/src/pipeline.ts), so
   * concurrent requests queue behind each other; a capture alone has been
   * observed taking 150s+ even without queueing. Must stay comfortably
   * under the job store's own TTL (see apps/api/src/jobs.ts), or a slow-but-
   * still-legitimate job could get pruned before this ever sees it finish.
   */
  maxMs?: number;
}

type PollStatus<T> = { status: 'pending'; stage?: string } | { status: 'done'; result: T } | { status: 'not-found' };

/** Shared poll-until-done loop for any start→jobId→poll flow (used by both
 * the daily analysis and the AI suggestion jobs). Throws on timeout or a
 * not-found job rather than returning a sentinel, so each caller maps the
 * failure into whatever shape its own result type expects. `onStage`, when
 * given, is called with each pending poll's `stage` (if the job reported
 * one; see apps/api/src/jobStore.ts) so a caller can show live progress
 * instead of one static "please wait" message. Jobs that never report a
 * stage (the daily pipeline, for now) simply never trigger it. */
export async function pollUntilDone<T>(
  poll: () => Promise<PollStatus<T>>,
  options: PollOptions = {},
  onStage?: (stage: string) => void,
): Promise<T> {
  const intervalMs = options.intervalMs ?? 2000;
  const maxMs = options.maxMs ?? 4.5 * 60 * 1000;
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    await sleep(intervalMs);
    const status = await poll();
    if (status.status === 'done') return status.result;
    if (status.status === 'not-found') throw new Error('Job expired or was never created');
    if (status.stage) onStage?.(status.stage);
    // status.status === 'pending'; keep polling
  }
  throw new Error('Timed out waiting for the job to finish');
}
