import test from 'node:test';
import assert from 'node:assert/strict';

import { readingsFromSignals } from '@stock-indicator-dailies/shared';

import { aggregate, scoreChart } from '../src/score.ts';

const truth = readingsFromSignals([
  ['macd', 'SELL'],
  ['slowStochastic', 'NEUTRAL'],
  ['sma', 'SELL'],
]);

test('perfect agreement scores 100%', () => {
  const card = scoreChart(truth, truth);
  assert.equal(card.total, 3);
  assert.equal(card.correct, 3);
  assert.equal(card.accuracy, 1);
  assert.deepEqual(card.disagreements, []);
});

test('a single miss is reported per indicator', () => {
  const predicted = readingsFromSignals([
    ['macd', 'NEUTRAL'], // wrong (truth SELL)
    ['slowStochastic', 'NEUTRAL'],
    ['sma', 'SELL'],
  ]);
  const card = scoreChart(predicted, truth, 'NVDA');
  assert.equal(card.correct, 2);
  assert.equal(card.total, 3);
  assert.equal(card.perIndicator.macd.correct, 0);
  assert.equal(card.perIndicator.sma.correct, 1);
  assert.deepEqual(card.disagreements, [
    { ticker: 'NVDA', indicator: 'macd', expected: 'SELL', got: 'NEUTRAL' },
  ]);
});

test('a missing predicted indicator counts as a miss', () => {
  const predicted = readingsFromSignals([
    ['macd', 'SELL'],
    ['sma', 'SELL'],
  ]);
  const card = scoreChart(predicted, truth);
  assert.equal(card.correct, 2);
  assert.equal(card.disagreements[0]!.got, '(missing)');
  assert.equal(card.disagreements[0]!.indicator, 'slowStochastic');
});

test('aggregate combines cards and accuracy', () => {
  const a = scoreChart(truth, truth); // 3/3
  const b = scoreChart(
    readingsFromSignals([
      ['macd', 'BUY'], // wrong
      ['slowStochastic', 'NEUTRAL'],
      ['sma', 'SELL'],
    ]),
    truth,
  ); // 2/3
  const agg = aggregate([a, b]);
  assert.equal(agg.correct, 5);
  assert.equal(agg.total, 6);
  assert.ok(Math.abs(agg.accuracy - 5 / 6) < 1e-9);
  assert.equal(agg.perIndicator.macd.total, 2);
  assert.equal(agg.perIndicator.macd.correct, 1);
});

test('empty aggregate is 100% (nothing to get wrong)', () => {
  assert.equal(aggregate([]).accuracy, 1);
});
