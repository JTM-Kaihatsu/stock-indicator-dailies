import test from 'node:test';
import assert from 'node:assert/strict';

import { INDICATOR_PARAMS, STOCHASTIC_THRESHOLDS } from '../src/indicators.ts';

test('MACD params match the PRD (8 / 17 / 9)', () => {
  assert.deepEqual(INDICATOR_PARAMS.macd, {
    fastLength: 8,
    slowLength: 17,
    signalSmoothing: 9,
  });
});

test('Slow Stochastic params match the PRD (%K 14 / %D 5)', () => {
  assert.deepEqual(INDICATOR_PARAMS.slowStochastic, {
    percentK: 14,
    percentD: 5,
  });
});

test('SMA period matches the PRD (10)', () => {
  assert.equal(INDICATOR_PARAMS.sma.period, 10);
});

test('Stochastic bands match the PRD (oversold < 20, overbought > 80)', () => {
  assert.deepEqual(STOCHASTIC_THRESHOLDS, { oversold: 20, overbought: 80 });
});
