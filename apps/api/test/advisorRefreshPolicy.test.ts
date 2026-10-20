import test from 'node:test';
import assert from 'node:assert/strict';

import { canReuseResearch, decideRefresh, isPastEarningsDate } from '../src/advisorRefreshPolicy.ts';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-20T15:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

// --- isPastEarningsDate ---

test('an earnings date is still current for the whole day it happens', () => {
  assert.equal(isPastEarningsDate('2026-10-20', new Date('2026-10-20T23:59:00Z')), false);
  assert.equal(isPastEarningsDate('2026-10-20', new Date('2026-10-21T00:00:01Z')), true);
});

test('no known earnings date is never "past"', () => {
  assert.equal(isPastEarningsDate(null, NOW), false);
});

// --- decideRefresh ---

test('no cached suggestion: regenerate', () => {
  assert.deepEqual(decideRefresh(null, NOW), { action: 'regenerate', reason: 'no-cache' });
});

test('earnings date passed: regenerate, regardless of how recently it was checked', () => {
  const d = decideRefresh({ nextEarningsDate: '2026-10-15', retrievedAt: ago(DAY), lastCheckedAt: ago(60_000) }, NOW);
  assert.deepEqual(d, { action: 'regenerate', reason: 'earnings-passed' });
});

test('no earnings date and older than a week: regenerate', () => {
  const d = decideRefresh({ nextEarningsDate: null, retrievedAt: ago(8 * DAY), lastCheckedAt: ago(DAY / 2) }, NOW);
  assert.deepEqual(d, { action: 'regenerate', reason: 'stale-no-earnings-date' });
});

test('no earnings date but under a week old: not a regeneration', () => {
  const d = decideRefresh({ nextEarningsDate: null, retrievedAt: ago(3 * DAY), lastCheckedAt: ago(2 * DAY) }, NOW);
  assert.deepEqual(d, { action: 'quick-check' });
});

test('known future date, not checked in over a day: quick check', () => {
  const d = decideRefresh({ nextEarningsDate: '2026-11-20', retrievedAt: ago(10 * DAY), lastCheckedAt: ago(2 * DAY) }, NOW);
  assert.deepEqual(d, { action: 'quick-check' });
});

test('known future date, never checked: quick check', () => {
  const d = decideRefresh({ nextEarningsDate: '2026-11-20', retrievedAt: ago(10 * DAY), lastCheckedAt: null }, NOW);
  assert.deepEqual(d, { action: 'quick-check' });
});

test('known future date, checked within a day: serve cached', () => {
  const d = decideRefresh({ nextEarningsDate: '2026-11-20', retrievedAt: ago(10 * DAY), lastCheckedAt: ago(DAY / 2) }, NOW);
  assert.deepEqual(d, { action: 'serve-cached' });
});

test('a known future date means age alone never forces a regeneration (the 7-day window is only the no-date fallback)', () => {
  const d = decideRefresh({ nextEarningsDate: '2026-11-20', retrievedAt: ago(60 * DAY), lastCheckedAt: ago(DAY / 2) }, NOW);
  assert.deepEqual(d, { action: 'serve-cached' });
});

// --- canReuseResearch: the deep-research gating ---

test('no cached research: never reusable', () => {
  assert.equal(canReuseResearch(null, { reason: 'no-cache', earningsDate: null }, NOW), false);
});

test('no-cache: research under a week old is reused (a sibling tolerance may have just researched)', () => {
  assert.equal(canReuseResearch({ retrievedAt: ago(3 * DAY) }, { reason: 'no-cache', earningsDate: null }, NOW), true);
  assert.equal(canReuseResearch({ retrievedAt: ago(8 * DAY) }, { reason: 'no-cache', earningsDate: null }, NOW), false);
});

test('stale-no-earnings-date: same plain weekly freshness test', () => {
  assert.equal(canReuseResearch({ retrievedAt: ago(2 * DAY) }, { reason: 'stale-no-earnings-date', earningsDate: null }, NOW), true);
  assert.equal(canReuseResearch({ retrievedAt: ago(9 * DAY) }, { reason: 'stale-no-earnings-date', earningsDate: null }, NOW), false);
});

test('material-news: research from 2 days ago is NOT reused, even though it is inside the weekly window (the old bug)', () => {
  assert.equal(canReuseResearch({ retrievedAt: ago(2 * DAY) }, { reason: 'material-news', earningsDate: '2026-11-20' }, NOW), false);
});

test('material-news: research from within the last day IS reused (a sibling tolerance just re-researched)', () => {
  assert.equal(canReuseResearch({ retrievedAt: ago(DAY / 4) }, { reason: 'material-news', earningsDate: '2026-11-20' }, NOW), true);
});

test('earnings-passed: research from before the earnings day ended is NOT reused, even inside the weekly window (the old bug)', () => {
  // Earnings were 2026-10-18; research from 2026-10-17 is only 3 days old.
  const research = { retrievedAt: '2026-10-17T12:00:00Z' };
  assert.equal(canReuseResearch(research, { reason: 'earnings-passed', earningsDate: '2026-10-18' }, NOW), false);
});

test('earnings-passed: research retrieved on the earnings day itself (before it ended) is not post-earnings', () => {
  const research = { retrievedAt: '2026-10-18T14:00:00Z' };
  assert.equal(canReuseResearch(research, { reason: 'earnings-passed', earningsDate: '2026-10-18' }, NOW), false);
});

test('earnings-passed: research retrieved after the earnings day ended IS reused (a sibling re-researched post-earnings)', () => {
  const research = { retrievedAt: '2026-10-19T09:00:00Z' };
  assert.equal(canReuseResearch(research, { reason: 'earnings-passed', earningsDate: '2026-10-18' }, NOW), true);
});

test('earnings-passed: without a known date there is nothing to compare against, so re-research', () => {
  assert.equal(canReuseResearch({ retrievedAt: ago(DAY) }, { reason: 'earnings-passed', earningsDate: null }, NOW), false);
});
