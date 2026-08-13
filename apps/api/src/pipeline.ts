import { TradingViewChartAgent } from '@stock-indicator-dailies/agent';
import { runDaily, type DailyResult } from '@stock-indicator-dailies/daily';
import { ClaudeVlmProvider } from '@stock-indicator-dailies/vlm';

import { cacheReport, getCachedReport, logFailure } from './cache.ts';

let agent: TradingViewChartAgent | undefined;
let provider: ClaudeVlmProvider | undefined;

function ensureInitialized() {
  agent ??= new TradingViewChartAgent();
  provider ??= new ClaudeVlmProvider();
}

// The agent drives a single browser session, so only one pipeline run can be
// in flight at a time. Concurrent callers queue and wait their turn rather
// than getting rejected — chaining onto this promise serializes execution.
let queue: Promise<unknown> = Promise.resolve();
let queueLength = 0;

/** Requests currently queued or running, for the health endpoint. */
export function pendingCount(): number {
  return queueLength;
}

export async function runPipeline(ticker: string): Promise<DailyResult> {
  // Cache check happens before the browser-automation path entirely, and
  // before joining the queue — a hit never waits on anything in flight.
  const cached = await getCachedReport(ticker);
  if (cached) return { ok: true, report: cached };

  queueLength++;
  const run = queue.then(() => runExclusive(ticker));
  // Swallow so one failed run doesn't wedge the chain for whoever's behind it.
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  try {
    return await run;
  } finally {
    queueLength--;
  }
}

/**
 * Runs with exclusive access to the browser session. Re-checks the cache
 * first: a same-ticker request that waited behind another may already have
 * its answer by the time its turn comes up, sparing a redundant run.
 */
async function runExclusive(ticker: string): Promise<DailyResult> {
  const cached = await getCachedReport(ticker);
  if (cached) return { ok: true, report: cached };

  ensureInitialized();
  const result = await runDaily({ ticker, agent: agent!, provider: provider! });
  if (result.ok) {
    await cacheReport(result.report);
  } else {
    await logFailure(ticker, result);
  }
  return result;
}
