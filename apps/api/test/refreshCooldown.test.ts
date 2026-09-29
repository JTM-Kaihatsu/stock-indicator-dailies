import test from 'node:test';
import assert from 'node:assert/strict';

import { computeRefreshAvailableAt, laterOf, marketGuardrailAvailableAt, proactiveRefreshAvailableAt } from '../src/refreshCooldown.ts';

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

// --- laterOf: combines the plain 1h cooldown with the market-hours
// guardrail (marketGuardrailAvailableAt) -- checkRefreshCooldown stays
// blocked until BOTH have cleared. ---

test('laterOf: null when neither restricts anything', () => {
  assert.equal(laterOf(null, null), null);
});

test('laterOf: whichever side is null contributes no restriction', () => {
  assert.equal(laterOf('2026-01-19T15:00:00.000Z', null), '2026-01-19T15:00:00.000Z');
  assert.equal(laterOf(null, '2026-01-19T15:00:00.000Z'), '2026-01-19T15:00:00.000Z');
});

test('laterOf: picks whichever timestamp is further in the future', () => {
  const earlier = '2026-01-19T15:00:00.000Z';
  const later = '2026-01-20T14:30:00.000Z';
  assert.equal(laterOf(earlier, later), later);
  assert.equal(laterOf(later, earlier), later);
});

// --- marketGuardrailAvailableAt ---

test('marketGuardrailAvailableAt: null when there has never been a successful refresh', () => {
  assert.equal(marketGuardrailAvailableAt(null, new Date('2026-01-19T23:00:00Z')), null);
});

test('marketGuardrailAvailableAt: null when the last success was during a live session', () => {
  const lastSuccess = new Date('2026-01-15T17:00:00Z').toISOString(); // Thursday noon ET
  assert.equal(marketGuardrailAvailableAt(lastSuccess, new Date('2026-01-15T18:00:00Z')), null);
});

test('marketGuardrailAvailableAt: returns the next market open when it applies', () => {
  const lastSuccess = new Date('2026-01-19T23:00:00Z').toISOString(); // Monday 6pm ET
  const now = new Date('2026-01-20T01:00:00Z'); // Monday 8pm ET
  assert.equal(marketGuardrailAvailableAt(lastSuccess, now), '2026-01-20T14:30:00.000Z'); // Tuesday 9:30am ET
});

test('marketGuardrailAvailableAt: null once the market has actually reopened', () => {
  const lastSuccess = new Date('2026-01-19T23:00:00Z').toISOString(); // Monday 6pm ET
  const now = new Date('2026-01-20T15:00:00Z'); // Tuesday 10am ET, after open
  assert.equal(marketGuardrailAvailableAt(lastSuccess, now), null);
});

test('marketGuardrailAvailableAt: an unparseable timestamp is ignored rather than throwing', () => {
  assert.equal(marketGuardrailAvailableAt('not-a-date', new Date('2026-01-19T23:00:00Z')), null);
});

// --- Combined scenario matching the request's own example: a market-hours
// block that outlasts the plain 1h cooldown, so the guardrail (not the
// cooldown) determines when refresh actually becomes available again. ---

test('combined: the market-hours guardrail outlasts the 1h cooldown, so it wins', () => {
  const lastSuccessAt = new Date('2026-01-19T23:00:00Z').toISOString(); // Monday 6pm ET
  const now = new Date('2026-01-20T01:00:00Z'); // Monday 8pm ET -- 2h later, past the 1h cooldown
  const cooldownAvailableAt = computeRefreshAvailableAt(lastSuccessAt, null, now.getTime());
  assert.equal(cooldownAvailableAt, null, 'the plain 1h cooldown has already cleared by 8pm');
  const marketAvailableAt = marketGuardrailAvailableAt(lastSuccessAt, now);
  const combined = laterOf(cooldownAvailableAt, marketAvailableAt);
  assert.equal(combined, '2026-01-20T14:30:00.000Z'); // still blocked until Tuesday's open
});

// --- proactiveRefreshAvailableAt: the immediate response right after
// kicking off a refresh, before its own capture has actually landed. ---

test('proactive: mid-session kickoff just gets the plain +1h window', () => {
  const now = new Date('2026-01-15T17:00:00Z'); // Thursday noon ET, market open
  assert.equal(proactiveRefreshAvailableAt(now), new Date(now.getTime() + HOUR).toISOString());
});

test('proactive: an after-close kickoff shows the real next-open wait, not a flat +1h', () => {
  const now = new Date('2026-01-15T23:00:00Z'); // Thursday 6pm ET, after close
  assert.equal(proactiveRefreshAvailableAt(now), '2026-01-16T14:30:00.000Z'); // Friday 9:30am ET
});

test('proactive: a Friday-evening kickoff accounts for the whole weekend', () => {
  const now = new Date('2026-01-16T23:00:00Z'); // Friday 6pm ET
  assert.equal(proactiveRefreshAvailableAt(now), '2026-01-19T14:30:00.000Z'); // Monday 9:30am ET
});
