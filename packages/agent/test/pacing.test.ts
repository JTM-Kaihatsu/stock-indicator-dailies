import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_PACING,
  humanDelayMs,
  pacingFromEnv,
  pause,
  RateLimiter,
} from '../src/pacing.ts';

test('humanDelayMs stays within bounds', () => {
  const opts = { minMs: 100, maxMs: 200 };
  assert.equal(humanDelayMs(opts, () => 0), 100);
  assert.equal(humanDelayMs(opts, () => 1), 200);
  assert.equal(humanDelayMs(opts, () => 0.5), 150);
});

test('humanDelayMs falls back to defaults', () => {
  assert.equal(humanDelayMs({}, () => 0), DEFAULT_PACING.minMs);
  assert.equal(humanDelayMs({}, () => 1), DEFAULT_PACING.maxMs);
});

test('humanDelayMs tolerates inverted bounds', () => {
  assert.equal(humanDelayMs({ minMs: 900, maxMs: 100 }, () => 0), 100);
  assert.equal(humanDelayMs({ minMs: 900, maxMs: 100 }, () => 1), 900);
});

test('pacingFromEnv reads env and falls back on garbage', () => {
  assert.deepEqual(
    pacingFromEnv({ AGENT_MIN_ACTION_DELAY_MS: '50', AGENT_MAX_ACTION_DELAY_MS: '75' } as NodeJS.ProcessEnv),
    { minMs: 50, maxMs: 75 },
  );
  assert.deepEqual(
    pacingFromEnv({ AGENT_MIN_ACTION_DELAY_MS: 'abc' } as NodeJS.ProcessEnv),
    DEFAULT_PACING,
  );
});

test('pause sleeps for the computed delay', async () => {
  const slept: number[] = [];
  const ms = await pause(
    { minMs: 10, maxMs: 10 },
    { random: () => 0.5, sleep: async (d) => void slept.push(d) },
  );
  assert.equal(ms, 10);
  assert.deepEqual(slept, [10]);
});

test('RateLimiter allows the first run immediately', () => {
  const limiter = new RateLimiter(1000, () => 0);
  assert.equal(limiter.allowed(), true);
  assert.equal(limiter.msUntilAllowed(), 0);
});

test('RateLimiter blocks until the interval elapses', () => {
  let now = 0;
  const limiter = new RateLimiter(1000, () => now);
  limiter.record();

  now = 400;
  assert.equal(limiter.allowed(), false);
  assert.equal(limiter.msUntilAllowed(), 600);

  now = 1000;
  assert.equal(limiter.allowed(), true);
  assert.equal(limiter.msUntilAllowed(), 0);
});
