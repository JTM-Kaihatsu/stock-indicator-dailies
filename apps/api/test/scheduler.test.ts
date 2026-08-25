import test from 'node:test';
import assert from 'node:assert/strict';

import { computeNextRunAt } from '../src/scheduler.ts';

// Expected UTC instants below were verified independently against Node's
// own Intl formatter (not against computeNextRunAt itself) before writing
// these assertions, e.g.:
//   new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', hour12: false })
//     .format(new Date('2026-03-08T11:00:00Z'))  // -> "07" (EDT)
// US DST 2026: starts Sun 2026-03-08 (2am EST -> 3am EDT), ends Sun
// 2026-11-01 (2am EDT -> 1am EST).

test('returns today at 7am ET when now is earlier that same day (EST, winter)', () => {
  // 2026-01-15 06:00 ET = 11:00 UTC (EST, UTC-5); 7am ET that day = 12:00 UTC.
  const now = new Date('2026-01-15T11:00:00Z');
  const next = computeNextRunAt(now);
  assert.equal(next.toISOString(), '2026-01-15T12:00:00.000Z');
});

test('returns tomorrow at 7am ET when now is later that same day (EDT, summer)', () => {
  // 2026-07-15 08:00 ET = 12:00 UTC (EDT, UTC-4); next 7am ET is the 16th, 11:00 UTC.
  const now = new Date('2026-07-15T12:00:00Z');
  const next = computeNextRunAt(now);
  assert.equal(next.toISOString(), '2026-07-16T11:00:00.000Z');
});

test('is strictly-after: now exactly at 7am ET rolls to tomorrow, not today', () => {
  const now = new Date('2026-01-15T12:00:00.000Z'); // exactly 7:00:00 ET
  const next = computeNextRunAt(now);
  assert.equal(next.toISOString(), '2026-01-16T12:00:00.000Z');
});

test('spring-forward transition day: 7am ET lands in EDT (UTC-4), no double-fire', () => {
  // now: 2026-03-07 08:00 ET = 13:00 UTC (EST, the day before the transition).
  const now = new Date('2026-03-07T13:00:00Z');
  const next = computeNextRunAt(now);
  // 2026-03-08 is the transition day; by 7am it's already EDT.
  assert.equal(next.toISOString(), '2026-03-08T11:00:00.000Z');
});

test('fall-back transition day: 7am ET lands in EST (UTC-5), no skipped day', () => {
  // now: 2026-10-31 08:00 ET = 12:00 UTC (EDT, the day before the transition).
  const now = new Date('2026-10-31T12:00:00Z');
  const next = computeNextRunAt(now);
  // 2026-11-01 is the transition day; by 7am it's already EST.
  assert.equal(next.toISOString(), '2026-11-01T12:00:00.000Z');
});

test('custom hourET is respected', () => {
  const now = new Date('2026-01-15T00:00:00Z'); // 2026-01-14 19:00 ET
  const next = computeNextRunAt(now, 9);
  // Next 9am ET after 2026-01-14 19:00 ET is 2026-01-15 09:00 ET = 14:00 UTC.
  assert.equal(next.toISOString(), '2026-01-15T14:00:00.000Z');
});
