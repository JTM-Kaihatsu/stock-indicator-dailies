import test from 'node:test';
import assert from 'node:assert/strict';

import { computeRefreshAvailableAt } from '../src/refreshCooldown.ts';

const HOUR = 60 * 60 * 1000;
const NOON = Date.parse('2026-09-10T12:00:00Z');

test('null when nothing has ever been attempted', () => {
  assert.equal(computeRefreshAvailableAt(null, null, NOON, HOUR), null);
});

test('null once an hour has passed since the last success', () => {
  const twoHoursAgo = new Date(NOON - 2 * HOUR).toISOString();
  assert.equal(computeRefreshAvailableAt(twoHoursAgo, null, NOON, HOUR), null);
});

test('returns success + cooldown while still inside the window', () => {
  const twentyMinAgo = new Date(NOON - 20 * 60 * 1000).toISOString();
  const out = computeRefreshAvailableAt(twentyMinAgo, null, NOON, HOUR);
  assert.equal(out, new Date(NOON + 40 * 60 * 1000).toISOString());
});

test('a more recent failure wins over an older success', () => {
  const successAt = new Date(NOON - 3 * HOUR).toISOString(); // long past cooldown
  const failureAt = new Date(NOON - 10 * 60 * 1000).toISOString(); // 10 min ago
  const out = computeRefreshAvailableAt(successAt, failureAt, NOON, HOUR);
  assert.equal(out, new Date(NOON + 50 * 60 * 1000).toISOString());
});

test('a more recent success wins over an older failure', () => {
  const failureAt = new Date(NOON - 5 * HOUR).toISOString();
  const successAt = new Date(NOON - 90 * 60 * 1000).toISOString(); // 1.5h ago, past cooldown
  assert.equal(computeRefreshAvailableAt(successAt, failureAt, NOON, HOUR), null);
});

test('exactly at the boundary is available (not strictly future)', () => {
  const oneHourAgo = new Date(NOON - HOUR).toISOString();
  assert.equal(computeRefreshAvailableAt(oneHourAgo, null, NOON, HOUR), null);
});

test('an unparseable timestamp is ignored rather than throwing', () => {
  assert.equal(computeRefreshAvailableAt('not-a-date', null, NOON, HOUR), null);
  const recent = new Date(NOON - 5 * 60 * 1000).toISOString();
  assert.equal(
    computeRefreshAvailableAt('not-a-date', recent, NOON, HOUR),
    new Date(NOON + 55 * 60 * 1000).toISOString(),
  );
});
