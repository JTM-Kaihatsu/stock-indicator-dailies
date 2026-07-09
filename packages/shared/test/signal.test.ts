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

// BUY requires all three; SELL requires at least two.

test('all three BUY -> BUY (unanimity required for BUY)', () => {
  assert.equal(deriveSignal(readings('BUY', 'BUY', 'BUY')), 'BUY');
});

test('two BUY + one NEUTRAL -> HOLD (BUY needs all three)', () => {
  assert.equal(deriveSignal(readings('BUY', 'BUY', 'NEUTRAL')), 'HOLD');
});

test('two BUY + one SELL -> HOLD (not unanimous, and only one SELL)', () => {
  assert.equal(deriveSignal(readings('BUY', 'BUY', 'SELL')), 'HOLD');
});

test('all three SELL -> SELL', () => {
  assert.equal(deriveSignal(readings('SELL', 'SELL', 'SELL')), 'SELL');
});

test('two SELL + one NEUTRAL -> SELL (two is enough for SELL)', () => {
  assert.equal(deriveSignal(readings('SELL', 'SELL', 'NEUTRAL')), 'SELL');
});

test('two SELL + one BUY -> SELL (two SELL fires even against a BUY)', () => {
  assert.equal(deriveSignal(readings('SELL', 'SELL', 'BUY')), 'SELL');
});

test('one SELL + two others -> HOLD (below SELL threshold of 2)', () => {
  assert.equal(deriveSignal(readings('SELL', 'BUY', 'NEUTRAL')), 'HOLD');
  assert.equal(deriveSignal(readings('SELL', 'NEUTRAL', 'NEUTRAL')), 'HOLD');
});

test('one BUY + two NEUTRAL -> HOLD', () => {
  assert.equal(deriveSignal(readings('BUY', 'NEUTRAL', 'NEUTRAL')), 'HOLD');
});

test('all NEUTRAL -> HOLD', () => {
  assert.equal(deriveSignal(readings('NEUTRAL', 'NEUTRAL', 'NEUTRAL')), 'HOLD');
});

test('empty readings -> HOLD', () => {
  assert.equal(deriveSignal([]), 'HOLD');
});

test('SELL takes precedence when custom thresholds allow both to match', () => {
  // Lowered BUY bar so a single BUY qualifies; a 2-SELL still wins.
  const opts = { buyConsensus: 1, sellConsensus: 2 };
  assert.equal(deriveSignal(readings('SELL', 'SELL', 'BUY'), opts), 'SELL');
});

test('custom buyConsensus can loosen the BUY requirement', () => {
  assert.equal(
    deriveSignal(readings('BUY', 'BUY', 'NEUTRAL'), { buyConsensus: 2 }),
    'BUY',
  );
});

test('signal is order-independent', () => {
  assert.equal(deriveSignal(readings('NEUTRAL', 'SELL', 'SELL')), 'SELL');
  assert.equal(deriveSignal(readings('SELL', 'NEUTRAL', 'SELL')), 'SELL');
});
