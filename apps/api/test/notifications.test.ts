import test from 'node:test';
import assert from 'node:assert/strict';

import { detectSignalEvents } from '../src/notifications.ts';

test('a ticker with no prior state that lands on BUY fires as a new event', () => {
  const events = detectSignalEvents(new Map(), new Map([['NVDA', 'BUY']]));
  assert.deepEqual(events, [{ ticker: 'NVDA', from: null, to: 'BUY' }]);
});

test('a ticker with no prior state that lands on HOLD does not fire', () => {
  const events = detectSignalEvents(new Map(), new Map([['NVDA', 'HOLD']]));
  assert.deepEqual(events, []);
});

test('unchanged BUY does not fire again', () => {
  const events = detectSignalEvents(new Map([['NVDA', 'BUY']]), new Map([['NVDA', 'BUY']]));
  assert.deepEqual(events, []);
});

test('HOLD -> BUY fires', () => {
  const events = detectSignalEvents(new Map([['NVDA', 'HOLD']]), new Map([['NVDA', 'BUY']]));
  assert.deepEqual(events, [{ ticker: 'NVDA', from: 'HOLD', to: 'BUY' }]);
});

test('a reversal, BUY -> SELL, fires (not just "new to BUY/SELL")', () => {
  const events = detectSignalEvents(new Map([['NVDA', 'BUY']]), new Map([['NVDA', 'SELL']]));
  assert.deepEqual(events, [{ ticker: 'NVDA', from: 'BUY', to: 'SELL' }]);
});

test('BUY -> HOLD does not fire (leaving BUY/SELL is not itself an event)', () => {
  const events = detectSignalEvents(new Map([['NVDA', 'BUY']]), new Map([['NVDA', 'HOLD']]));
  assert.deepEqual(events, []);
});

test('multiple tickers: only the ones that actually changed into BUY/SELL are returned, sorted by ticker', () => {
  const prior = new Map([
    ['NVDA', 'BUY'],
    ['GOOG', 'HOLD'],
    ['AVGO', 'SELL'],
  ]);
  const current = new Map([
    ['NVDA', 'BUY'], // unchanged, no event
    ['GOOG', 'BUY'], // HOLD -> BUY, event
    ['AVGO', 'HOLD'], // SELL -> HOLD, no event (leaving isn't an event)
    ['COST', 'SELL'], // brand new, event
  ]);
  const events = detectSignalEvents(prior, current);
  assert.deepEqual(events, [
    { ticker: 'COST', from: null, to: 'SELL' },
    { ticker: 'GOOG', from: 'HOLD', to: 'BUY' },
  ]);
});

test('an empty current map produces no events regardless of prior state', () => {
  const events = detectSignalEvents(new Map([['NVDA', 'HOLD']]), new Map());
  assert.deepEqual(events, []);
});
