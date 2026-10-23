import test from 'node:test';
import assert from 'node:assert/strict';

import type { DailyResult } from '@stock-indicator-dailies/daily';

import { isTransientFailure, runWithRetry, withTimeout } from '../src/pipeline.ts';

// withTimeout and the capture retry are covered here — the rest of pipeline.ts drives real
// Chromium and Supabase and has no existing test file for the same reason
// (not structured for unit testing without mocking both). This is the one
// piece that's pure enough to test directly, and it's the load-bearing
// guarantee behind the whole fix: a hung capture must never again wedge the
// pipeline's queue for every ticker behind it (see runExclusive's comment).

test('resolves with the value when the promise settles before the deadline', async () => {
  const result = await withTimeout(Promise.resolve('ok'), 1000, 'test');
  assert.equal(result, 'ok');
});

test('rejects with the original error when the promise rejects before the deadline', async () => {
  await assert.rejects(
    withTimeout(Promise.reject(new Error('boom')), 1000, 'test'),
    /boom/,
  );
});

test('rejects with a timeout error once the deadline passes, even though the original promise never settles', async () => {
  const neverSettles = new Promise<string>(() => {});
  await assert.rejects(
    withTimeout(neverSettles, 10, 'stuck-thing'),
    /stuck-thing timed out after 10ms/,
  );
});

// --- capture retry ---


const TIMINGS = { captureMs: 0, analyzeMs: 0, deterministicMs: 0, totalMs: 0, withinTarget: false };
const failure = (stage: 'capture' | 'analysis', reason: string): DailyResult => ({ ok: false, stage, reason, errors: [reason], timings: TIMINGS });
const success = { ok: true, report: { ticker: 'MU' } } as unknown as DailyResult;
const noSleep = async () => {};

test('studies-not-rendered, popup-blocking and timeout are transient', () => {
  for (const reason of ['studies-not-rendered', 'popup-blocking', 'timeout']) {
    assert.equal(isTransientFailure(failure('capture', reason)), true, reason);
  }
});

test('persistent or non-capture failures are not retried', () => {
  for (const reason of ['chart-not-found', 'not-authenticated', 'unknown-ticker', 'wrong-interval', 'unknown']) {
    assert.equal(isTransientFailure(failure('capture', reason)), false, reason);
  }
  assert.equal(isTransientFailure(failure('analysis', 'invalid-verdict')), false);
  assert.equal(isTransientFailure(success), false);
});

test('a success on the first try is returned without a retry', async () => {
  let calls = 0;
  const result = await runWithRetry(async () => (calls++, success), { sleepFn: noSleep });
  assert.equal(calls, 1);
  assert.equal(result, success);
});

test('a transient failure that clears on the second try returns the success (the MU case)', async () => {
  const results = [failure('capture', 'studies-not-rendered'), success];
  let calls = 0;
  const retried: DailyResult[] = [];
  const result = await runWithRetry(async () => results[calls++]!, { sleepFn: noSleep, onRetry: (f) => retried.push(f) });
  assert.equal(calls, 2);
  assert.equal(result, success);
  assert.equal(retried.length, 1);
});

test('a transient failure that persists is retried exactly once, then reported', async () => {
  let calls = 0;
  const result = await runWithRetry(async () => (calls++, failure('capture', 'studies-not-rendered')), { sleepFn: noSleep });
  assert.equal(calls, 2);
  assert.equal(result.ok, false);
});

test('a persistent failure is never retried', async () => {
  let calls = 0;
  const result = await runWithRetry(async () => (calls++, failure('capture', 'chart-not-found')), { sleepFn: noSleep });
  assert.equal(calls, 1);
  assert.equal(result.ok, false);
});

test('waits the configured delay before retrying', async () => {
  const waits: number[] = [];
  await runWithRetry(async () => failure('capture', 'timeout'), { delayMs: 1234, sleepFn: async (ms) => void waits.push(ms) });
  assert.deepEqual(waits, [1234]);
});
