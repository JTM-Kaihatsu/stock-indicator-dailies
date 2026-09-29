import test from 'node:test';
import assert from 'node:assert/strict';

import { isMarketOpenAt, marketHasNotReopenedSince, nextMarketOpenAfter } from '../src/marketHours.ts';

// Expected UTC instants below were verified independently against Node's
// own Intl formatter (not against this module's own functions) before
// writing these assertions, same convention as scheduler.test.ts. US DST
// 2026: starts Sun 2026-03-08 (2am EST -> 3am EDT), ends Sun 2026-11-01
// (2am EDT -> 1am EST).
// 2026-01-15 is a Thursday; 16th Friday, 17th Saturday, 18th Sunday, 19th Monday.

// --- isMarketOpenAt ---

test('open at 9:30am ET exactly (the open boundary is inclusive)', () => {
  // 2026-01-15 09:30 ET = 14:30 UTC (EST, UTC-5).
  assert.equal(isMarketOpenAt(new Date('2026-01-15T14:30:00Z')), true);
});

test('closed a second before 9:30am ET', () => {
  assert.equal(isMarketOpenAt(new Date('2026-01-15T14:29:59Z')), false);
});

test('open at mid-session, e.g. noon ET', () => {
  assert.equal(isMarketOpenAt(new Date('2026-01-15T17:00:00Z')), true); // noon ET
});

test('closed exactly at 4:00pm ET (the close boundary is exclusive)', () => {
  // 2026-01-15 16:00 ET = 21:00 UTC.
  assert.equal(isMarketOpenAt(new Date('2026-01-15T21:00:00Z')), false);
});

test('open a second before 4:00pm ET', () => {
  assert.equal(isMarketOpenAt(new Date('2026-01-15T20:59:59Z')), true);
});

test('closed in the evening', () => {
  assert.equal(isMarketOpenAt(new Date('2026-01-15T23:00:00Z')), false); // 6pm ET
});

test('closed before the open, early morning', () => {
  assert.equal(isMarketOpenAt(new Date('2026-01-15T11:00:00Z')), false); // 6am ET
});

test('closed on a Saturday, even during what would be session hours on a weekday', () => {
  assert.equal(isMarketOpenAt(new Date('2026-01-17T17:00:00Z')), false); // Saturday noon ET
});

test('closed on a Sunday', () => {
  assert.equal(isMarketOpenAt(new Date('2026-01-18T17:00:00Z')), false); // Sunday noon ET
});

test('DST: open at 9:30am EDT in summer', () => {
  // 2026-07-15 09:30 ET = 13:30 UTC (EDT, UTC-4).
  assert.equal(isMarketOpenAt(new Date('2026-07-15T13:30:00Z')), true);
});

// --- nextMarketOpenAfter ---

test('same-day: before today\'s open resolves to today\'s open', () => {
  const next = nextMarketOpenAfter(new Date('2026-01-15T11:00:00Z')); // 6am ET Thursday
  assert.equal(next.toISOString(), '2026-01-15T14:30:00.000Z'); // 9:30am ET same day
});

test('mid-session: resolves to tomorrow\'s open, not today\'s (already past)', () => {
  const next = nextMarketOpenAfter(new Date('2026-01-15T17:00:00Z')); // noon ET Thursday
  assert.equal(next.toISOString(), '2026-01-16T14:30:00.000Z'); // 9:30am ET Friday
});

test('evening after close: resolves to the next weekday\'s open', () => {
  const next = nextMarketOpenAfter(new Date('2026-01-15T23:00:00Z')); // 6pm ET Thursday
  assert.equal(next.toISOString(), '2026-01-16T14:30:00.000Z'); // 9:30am ET Friday
});

test('Friday evening rolls to Monday, not Saturday', () => {
  const next = nextMarketOpenAfter(new Date('2026-01-17T01:00:00Z')); // 2026-01-16 20:00 ET, Friday night
  assert.equal(next.toISOString(), '2026-01-19T14:30:00.000Z'); // Monday 9:30am EST
});

test('weekend: Saturday rolls to Monday', () => {
  const next = nextMarketOpenAfter(new Date('2026-01-17T17:00:00Z')); // Saturday noon ET
  assert.equal(next.toISOString(), '2026-01-19T14:30:00.000Z');
});

test('weekend: Sunday rolls to Monday', () => {
  const next = nextMarketOpenAfter(new Date('2026-01-18T17:00:00Z')); // Sunday noon ET
  assert.equal(next.toISOString(), '2026-01-19T14:30:00.000Z');
});

// --- marketHasNotReopenedSince: the guardrail itself, matching the
// request's own worked example verbatim ---

test("Monday 6pm refresh blocks a Monday 8pm attempt", () => {
  // Monday 2026-01-19 18:00 ET = 23:00 UTC; 20:00 ET = 2026-01-20 01:00 UTC.
  const lastRefresh = new Date('2026-01-19T23:00:00Z');
  const attempt = new Date('2026-01-20T01:00:00Z');
  assert.equal(marketHasNotReopenedSince(lastRefresh, attempt), true);
});

test('Monday 6pm refresh blocks a Tuesday 4am attempt', () => {
  const lastRefresh = new Date('2026-01-19T23:00:00Z'); // Monday 6pm ET
  const attempt = new Date('2026-01-20T09:00:00Z'); // Tuesday 4am ET
  assert.equal(marketHasNotReopenedSince(lastRefresh, attempt), true);
});

test('Monday 6pm refresh no longer blocks once Tuesday 9:30am ET arrives', () => {
  const lastRefresh = new Date('2026-01-19T23:00:00Z'); // Monday 6pm ET
  const atOpen = new Date('2026-01-20T14:30:00Z'); // Tuesday 9:30am ET exactly
  assert.equal(marketHasNotReopenedSince(lastRefresh, atOpen), false);
  const justBefore = new Date('2026-01-20T14:29:59Z');
  assert.equal(marketHasNotReopenedSince(lastRefresh, justBefore), true);
});

test('Friday 6pm refresh blocks the entire weekend, including Saturday and Sunday', () => {
  const lastRefresh = new Date('2026-01-16T23:00:00Z'); // Friday 6pm ET
  assert.equal(marketHasNotReopenedSince(lastRefresh, new Date('2026-01-17T17:00:00Z')), true); // Saturday noon ET
  assert.equal(marketHasNotReopenedSince(lastRefresh, new Date('2026-01-18T17:00:00Z')), true); // Sunday noon ET
  assert.equal(marketHasNotReopenedSince(lastRefresh, new Date('2026-01-19T13:00:00Z')), true); // Monday 8am ET, before open
  assert.equal(marketHasNotReopenedSince(lastRefresh, new Date('2026-01-19T15:00:00Z')), false); // Monday 10am ET, after open
});

test('a refresh during a live session never blocks a later same-day attempt', () => {
  const lastRefresh = new Date('2026-01-15T17:00:00Z'); // Thursday noon ET, market open
  const attempt = new Date('2026-01-15T20:00:00Z'); // Thursday 3pm ET, still open
  assert.equal(marketHasNotReopenedSince(lastRefresh, attempt), false);
});

test('a refresh one second before close still counts as "during market hours", so the guardrail never applies', () => {
  const lastRefresh = new Date('2026-01-15T20:59:59Z'); // Thursday 3:59:59pm ET, one second before close
  // Checked well into the evening, long after this refresh -- still not
  // blocked, because isMarketOpenAt(lastRefresh) was true, so this
  // guardrail is a no-op regardless of when `now` is; the ordinary 1h
  // cooldown is what governs a refresh that landed mid-session.
  assert.equal(marketHasNotReopenedSince(lastRefresh, new Date('2026-01-15T23:00:00Z')), false);
});

test('a refresh exactly at the close boundary is treated as after-close', () => {
  const lastRefresh = new Date('2026-01-15T21:00:00Z'); // Thursday 4:00:00pm ET exactly
  const attempt = new Date('2026-01-16T14:00:00Z'); // Friday 9am ET, before Friday's open
  assert.equal(marketHasNotReopenedSince(lastRefresh, attempt), true);
});

test('an early-morning refresh before today\'s own open still resolves against today\'s open', () => {
  const lastRefresh = new Date('2026-01-15T12:00:00Z'); // Thursday 7am ET
  assert.equal(marketHasNotReopenedSince(lastRefresh, new Date('2026-01-15T14:00:00Z')), true); // 9am ET, still before open
  assert.equal(marketHasNotReopenedSince(lastRefresh, new Date('2026-01-15T15:00:00Z')), false); // 10am ET, after open
});
