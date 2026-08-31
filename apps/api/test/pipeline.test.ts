import test from 'node:test';
import assert from 'node:assert/strict';

import { withTimeout } from '../src/pipeline.ts';

// Only withTimeout is covered here — the rest of pipeline.ts drives real
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
