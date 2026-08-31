import { TradingViewChartAgent } from '@stock-indicator-dailies/agent';
import { runDaily, type DailyResult } from '@stock-indicator-dailies/daily';
import { ClaudeVlmProvider } from '@stock-indicator-dailies/vlm';

import { cacheReport, getCachedReport, logFailure } from './cache.ts';
import { logSignalHistory } from './signalHistory.ts';

let agent: TradingViewChartAgent | undefined;
let provider: ClaudeVlmProvider | undefined;

function ensureInitialized() {
  agent ??= new TradingViewChartAgent();
  provider ??= new ClaudeVlmProvider();
}

// The agent drives a single browser session, so only one pipeline run can be
// in flight at a time. Concurrent callers queue and wait their turn rather
// than getting rejected; chaining onto this promise serializes execution.
let queue: Promise<unknown> = Promise.resolve();
let queueLength = 0;

/** Requests currently queued or running, for the health endpoint. */
export function pendingCount(): number {
  return queueLength;
}

// Per-ticker tracking, independent of the queue above (which is anonymous):
// lets callers (the watchlist routes) tell "queued or actively running" and
// "attempted too recently to try again" apart from a genuine failure with
// nothing in flight. Process-local, same accepted caveat as pendingCount.
const runningTickers = new Set<string>();
const lastAttemptAt = new Map<string, number>();
const RETRY_COOLDOWN_MS = 30_000;

/** Whether `ticker` is currently queued or actively running. */
export function isRunning(ticker: string): boolean {
  return runningTickers.has(ticker);
}

/** Whether enough time has passed since the last runPipeline call for this
 * ticker to attempt another one; guards against a user's page-reload (or
 * several open tabs) re-triggering a run for the same still-failing ticker
 * every few seconds. Not tied to success/failure specifically, just "was an
 * attempt made recently" — a fresh success naturally resolves via the cache
 * check before this is ever consulted. */
export function canAttempt(ticker: string): boolean {
  const last = lastAttemptAt.get(ticker);
  return last === undefined || Date.now() - last >= RETRY_COOLDOWN_MS;
}

/**
 * Paced gap enforced between the END of one queued run and the START of
 * the next, on top of runDaily's own human-like in-capture delays. Matters
 * for bulk situations (adding several watchlist tickers at once, or the
 * daily scheduler sweep) where several captures would otherwise fire
 * back-to-back with zero gap; a lone ad-hoc request never pays this cost,
 * since the delay lives in the queue handoff, not in the caller's own
 * awaited result. Configurable since "how cautious to be" is a judgment
 * call, not a fixed fact.
 */
const QUEUE_PACING_MS = Number(process.env.WATCHLIST_QUEUE_PACING_MS ?? 4000);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Hard ceiling on one ticker's whole `runExclusive` call (capture + analyze
 * + the follow-up Supabase writes). Every individual sub-step already has
 * its own timeout (page load, screenshot, the Anthropic call), but nothing
 * previously bounded the *whole thing* — so if any single step ever hung
 * instead of cleanly erroring (observed live: a `page.evaluate` with no
 * timeout of its own, since fixed in packages/agent, but the same risk
 * exists for any future step, including a stalled Supabase write with no
 * built-in fetch timeout), `runExclusive` would never settle. That's fatal
 * beyond just that one ticker: `queue` below only advances once `run`
 * settles (see runPipeline), so a single hang permanently wedges *every*
 * future call — not just the rest of that day's sweep, but any later sweep
 * and any ad-hoc user request too — until the whole process happens to
 * restart for an unrelated reason. From the outside that's indistinguishable
 * from a crash (chart_cache just stops updating), but it's a hang, not a
 * crash, and no amount of memory headroom fixes a hang.
 *
 * Generous, not tuned: a real run (including capture-side popup retries and
 * the VLM/advisor's own up-to-~90s-per-attempt timeouts) normally finishes
 * in well under a minute; this exists purely as a backstop of last resort.
 */
const PIPELINE_TIMEOUT_MS = Number(process.env.PIPELINE_TIMEOUT_MS ?? 5 * 60_000);

export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export async function runPipeline(ticker: string): Promise<DailyResult> {
  // Cache check happens before the browser-automation path entirely, and
  // before joining the queue; a hit never waits on anything in flight.
  const cached = await getCachedReport(ticker);
  if (cached) return { ok: true, report: cached };

  runningTickers.add(ticker);
  lastAttemptAt.set(ticker, Date.now());
  queueLength++;
  const run = queue.then(() => runExclusive(ticker));
  // Swallow so one failed run doesn't wedge the chain for whoever's behind
  // it; the pacing delay applies whether this run succeeded or failed.
  queue = run.then(
    () => sleep(QUEUE_PACING_MS),
    () => sleep(QUEUE_PACING_MS),
  );
  try {
    return await run;
  } finally {
    queueLength--;
    runningTickers.delete(ticker);
  }
}

/** The actual work `runExclusive` bounds with `withTimeout` below; split out
 * only so that wrapping is a one-line call, not a factor in its own right. */
async function attempt(ticker: string): Promise<DailyResult> {
  ensureInitialized();
  const result = await runDaily({ ticker, agent: agent!, provider: provider! });
  if (result.ok) {
    // Independent, both best-effort: run concurrently rather than
    // sequentially awaiting each.
    await Promise.all([cacheReport(result.report), logSignalHistory(result.report)]);
  } else {
    await logFailure(ticker, result);
  }
  return result;
}

/**
 * Runs with exclusive access to the browser session. Re-checks the cache
 * first: a same-ticker request that waited behind another may already have
 * its answer by the time its turn comes up, sparing a redundant run.
 */
async function runExclusive(ticker: string): Promise<DailyResult> {
  const cached = await getCachedReport(ticker);
  if (cached) return { ok: true, report: cached };

  try {
    return await withTimeout(attempt(ticker), PIPELINE_TIMEOUT_MS, `runExclusive(${ticker})`);
  } catch (err) {
    // `attempt` already wraps every stage runDaily knows about in its own
    // try/catch, converting expected failures into a clean `ok: false`
    // logged via logFailure inside it — so reaching here means either the
    // PIPELINE_TIMEOUT_MS backstop fired, or something threw from outside
    // that coverage entirely (ensureInitialized, an unanticipated bug).
    // Without this, the daily scheduler's sweep (scheduler.ts) only
    // console.errors it and moves on to the next ticker: no capture_failures
    // row, no way to tell afterward whether a ticker was ever even attempted
    // that day versus genuinely failed. Logged here, then re-thrown so
    // callers see the same behavior as before (the scheduler's
    // console.error, an ad-hoc caller's rejection).
    const failure: Extract<DailyResult, { ok: false }> = {
      ok: false,
      stage: 'capture',
      reason: 'unexpected-exception',
      errors: [err instanceof Error ? err.message : String(err)],
      timings: { captureMs: 0, analyzeMs: 0, deterministicMs: 0, totalMs: 0, withinTarget: false },
    };
    await logFailure(ticker, failure);
    throw err;
  }
}
