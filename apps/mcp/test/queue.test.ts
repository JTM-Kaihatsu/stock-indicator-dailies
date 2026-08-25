import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SerialQueue } from '../src/queue.ts';

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

test('a second call does not start until the first resolves', async () => {
  const queue = new SerialQueue();
  const order: string[] = [];
  const first = deferred<void>();

  const runA = queue.run(async () => {
    order.push('a-start');
    await first.promise;
    order.push('a-end');
  });
  const runB = queue.run(async () => {
    order.push('b-start');
  });

  // Give runB every chance to jump the queue before A finishes.
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(order, ['a-start']);

  first.resolve();
  await Promise.all([runA, runB]);
  assert.deepEqual(order, ['a-start', 'a-end', 'b-start']);
});

test('a failed call does not wedge the queue for calls behind it', async () => {
  const queue = new SerialQueue();
  const runA = queue.run(async () => {
    throw new Error('boom');
  });
  const runB = queue.run(async () => 'ok');

  await assert.rejects(runA, /boom/);
  assert.equal(await runB, 'ok');
});

test('run returns the function\'s resolved value', async () => {
  const queue = new SerialQueue();
  const result = await queue.run(async () => 42);
  assert.equal(result, 42);
});
