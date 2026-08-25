import test from 'node:test';
import assert from 'node:assert/strict';

import { lastChangedAt, type SignalHistoryRecord } from '../src/signalHistory.ts';

function row(overall: 'BUY' | 'SELL' | 'HOLD', capturedAt: string): SignalHistoryRecord {
  return { ticker: 'NVDA', captured_at: capturedAt, overall, computed: overall, ai: overall };
}

test('returns null for an empty history', () => {
  assert.equal(lastChangedAt([]), null);
});

test('a single row: last changed is that row itself', () => {
  const rows = [row('BUY', '2026-08-20T12:00:00Z')];
  assert.equal(lastChangedAt(rows), '2026-08-20T12:00:00Z');
});

test('consistent run: last changed is the oldest row still matching the current value', () => {
  // Newest-first, as the caller (getLastChangedMap) always provides.
  const rows = [
    row('BUY', '2026-08-24T12:00:00Z'),
    row('BUY', '2026-08-23T12:00:00Z'),
    row('BUY', '2026-08-22T12:00:00Z'),
    row('SELL', '2026-08-21T12:00:00Z'),
  ];
  assert.equal(lastChangedAt(rows), '2026-08-22T12:00:00Z');
});

test('a value that just changed on the most recent capture returns that capture', () => {
  const rows = [
    row('SELL', '2026-08-24T12:00:00Z'),
    row('BUY', '2026-08-23T12:00:00Z'),
    row('BUY', '2026-08-22T12:00:00Z'),
  ];
  assert.equal(lastChangedAt(rows), '2026-08-24T12:00:00Z');
});

test('no change across the whole window: returns the oldest row provided', () => {
  const rows = [
    row('HOLD', '2026-08-24T12:00:00Z'),
    row('HOLD', '2026-08-23T12:00:00Z'),
    row('HOLD', '2026-08-22T12:00:00Z'),
  ];
  assert.equal(lastChangedAt(rows), '2026-08-22T12:00:00Z');
});
