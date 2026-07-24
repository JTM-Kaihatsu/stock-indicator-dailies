import test from 'node:test';
import assert from 'node:assert/strict';

import {
  INDICATOR_PARAMS,
  STOCHASTIC_THRESHOLDS,
  CHART_WINDOW,
} from '../src/indicators.ts';

test('MACD params match the PRD (8 / 17 / 9)', () => {
  assert.deepEqual(INDICATOR_PARAMS.macd, {
    fastLength: 8,
    slowLength: 17,
    signalSmoothing: 9,
  });
});

test('Slow Stochastic params match the live "Rule 1" layout (14 / 5 / 3)', () => {
  assert.deepEqual(INDICATOR_PARAMS.slowStochastic, {
    percentKLength: 14,
    percentKSmoothing: 5,
    percentDSmoothing: 3,
  });
});

test('SMA period matches the PRD (10)', () => {
  assert.equal(INDICATOR_PARAMS.sma.period, 10);
});

test('Stochastic bands match the PRD (oversold < 20, overbought > 80)', () => {
  assert.deepEqual(STOCHASTIC_THRESHOLDS, { oversold: 20, overbought: 80 });
});

test('chart window pins the daily interval, not a span', () => {
  // The interval is load-bearing (indicators are defined on daily closes);
  // the visible span is observational because TradingView stores zoom, not range.
  assert.equal(CHART_WINDOW.interval, 'daily');
  assert.equal(typeof CHART_WINDOW.approximateMonths, 'number');
});
