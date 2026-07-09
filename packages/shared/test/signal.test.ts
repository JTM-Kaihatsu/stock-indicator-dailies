import test from 'node:test';
import assert from 'node:assert/strict';

import {
  deriveSignal,
  tallyReadings,
  readingsFromSignals,
} from '../src/signal.ts';
import type { IndicatorReading } from '../src/types.ts';

/** Build the standard 3-indicator reading set from a [macd, stoch, sma] triple. */
function readings(
  macd: IndicatorReading['signal'],
  stoch: IndicatorReading['signal'],
  sma: IndicatorReading['signal'],
): IndicatorReading[] {
  return readingsFromSignals([
    ['macd', macd],
    ['slowStochastic', stoch],
    ['sma', sma],
  ]);
}

test('tallyReadings counts each directional bucket', () => {
  const t = tallyReadings(readings('BUY', 'SELL', 'NEUTRAL'));
  assert.deepEqual(t, { buys: 1, sells: 1, neutrals: 1 });
});

test('all three BUY -> BUY', () => {
  assert.equal(deriveSignal(readings('BUY', 'BUY', 'BUY')), 'BUY');
});

test('all three SELL -> SELL', () => {
  assert.equal(deriveSignal(readings('SELL', 'SELL', 'SELL')), 'SELL');
});

test('two BUY + one NEUTRAL -> BUY (majority, no contradiction)', () => {
  assert.equal(deriveSignal(readings('BUY', 'BUY', 'NEUTRAL')), 'BUY');
});

test('two SELL + one NEUTRAL -> SELL', () => {
  assert.equal(deriveSignal(readings('SELL', 'SELL', 'NEUTRAL')), 'SELL');
});

test('two BUY + one SELL -> HOLD (contradiction always resolves to HOLD)', () => {
  assert.equal(deriveSignal(readings('BUY', 'BUY', 'SELL')), 'HOLD');
});

test('two SELL + one BUY -> HOLD (contradiction)', () => {
  assert.equal(deriveSignal(readings('SELL', 'SELL', 'BUY')), 'HOLD');
});

test('one BUY + two NEUTRAL -> HOLD (below default consensus of 2)', () => {
  assert.equal(deriveSignal(readings('BUY', 'NEUTRAL', 'NEUTRAL')), 'HOLD');
});

test('all NEUTRAL -> HOLD', () => {
  assert.equal(deriveSignal(readings('NEUTRAL', 'NEUTRAL', 'NEUTRAL')), 'HOLD');
});

test('empty readings -> HOLD', () => {
  assert.equal(deriveSignal([]), 'HOLD');
});

test('minConsensus: 3 requires unanimity', () => {
  const opts = { minConsensus: 3 };
  assert.equal(deriveSignal(readings('BUY', 'BUY', 'NEUTRAL'), opts), 'HOLD');
  assert.equal(deriveSignal(readings('BUY', 'BUY', 'BUY'), opts), 'BUY');
});

test('minConsensus: 1 emits on a single reading, but contradiction still HOLDs', () => {
  const opts = { minConsensus: 1 };
  assert.equal(deriveSignal(readings('BUY', 'NEUTRAL', 'NEUTRAL'), opts), 'BUY');
  assert.equal(deriveSignal(readings('SELL', 'NEUTRAL', 'NEUTRAL'), opts), 'SELL');
  assert.equal(deriveSignal(readings('BUY', 'SELL', 'NEUTRAL'), opts), 'HOLD');
});

test('signal is order-independent', () => {
  assert.equal(deriveSignal(readings('NEUTRAL', 'BUY', 'BUY')), 'BUY');
  assert.equal(deriveSignal(readings('BUY', 'NEUTRAL', 'BUY')), 'BUY');
});
