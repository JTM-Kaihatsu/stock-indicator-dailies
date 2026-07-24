import test from 'node:test';
import assert from 'node:assert/strict';

import {
  oracleReadings,
  readMacd,
  readSma,
  readStochastic,
  type IndicatorValues,
} from '../src/oracle.ts';

test('MACD: below signal above zero -> SELL', () => {
  assert.equal(readMacd({ macd: 1.2, signal: 1.5, histogram: -0.3 }), 'SELL');
});

test('MACD: above signal below zero -> BUY', () => {
  assert.equal(readMacd({ macd: -0.5, signal: -0.9, histogram: 0.4 }), 'BUY');
});

test('MACD: above signal above zero -> NEUTRAL (not the below-zero buy setup)', () => {
  assert.equal(readMacd({ macd: 1.29, signal: 0.8889, histogram: 0.4 }), 'NEUTRAL');
});

test('MACD: below signal below zero -> NEUTRAL', () => {
  assert.equal(readMacd({ macd: -1.2, signal: -0.9, histogram: -0.3 }), 'NEUTRAL');
});

test('Stoch: %K above %D while oversold -> BUY', () => {
  assert.equal(readStochastic({ percentK: 15, percentD: 10 }), 'BUY');
});

test('Stoch: %K below %D while overbought -> SELL', () => {
  assert.equal(readStochastic({ percentK: 82, percentD: 88 }), 'SELL');
});

test('Stoch: crossover in the mid-range -> NEUTRAL', () => {
  assert.equal(readStochastic({ percentK: 71.62, percentD: 69.67 }), 'NEUTRAL');
});

test('Stoch: %K above %D but overbought (not oversold) -> NEUTRAL', () => {
  assert.equal(readStochastic({ percentK: 85, percentD: 82 }), 'NEUTRAL');
});

test('SMA: close above -> BUY, below -> SELL', () => {
  assert.equal(readSma(207.63, 210), 'BUY');
  assert.equal(readSma(207.63, 206.84), 'SELL');
});

test('oracleReadings on the real captured NVDA legend', () => {
  // Values read live from TradingView: MACD 1.29/0.8889, Stoch 71.62/69.67,
  // SMA 207.63, close 206.84.
  const values: IndicatorValues = {
    macd: { macd: 1.29, signal: 0.8889, histogram: 0.3992 },
    stochastic: { percentK: 71.62, percentD: 69.67 },
    sma: 207.63,
    close: 206.84,
  };
  const readings = oracleReadings(values);
  const byKey = Object.fromEntries(readings.map((r) => [r.indicator, r.signal]));
  assert.deepEqual(byKey, {
    macd: 'NEUTRAL',
    slowStochastic: 'NEUTRAL',
    sma: 'SELL', // 206.84 < 207.63
  });
});
