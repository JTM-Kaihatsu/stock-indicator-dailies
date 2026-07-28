import test from 'node:test';
import assert from 'node:assert/strict';

import { ema, macdSeries, sma, stochasticSeries, type Bar } from '../src/compute.ts';

const approx = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

test('sma warms up then averages the trailing window', () => {
  const out = sma([1, 2, 3, 4, 5], 3);
  assert.ok(Number.isNaN(out[0]!) && Number.isNaN(out[1]!));
  assert.ok(approx(out[2]!, 2)); // (1+2+3)/3
  assert.ok(approx(out[3]!, 3)); // (2+3+4)/3
  assert.ok(approx(out[4]!, 4)); // (3+4+5)/3
});

test('ema seeds with the SMA of the first period, then recurs', () => {
  const out = ema([1, 2, 3, 4, 5], 3);
  assert.ok(Number.isNaN(out[1]!));
  assert.ok(approx(out[2]!, 2)); // seed = mean(1,2,3)
  // k = 2/4 = 0.5; out[3] = 4*0.5 + 2*0.5 = 3
  assert.ok(approx(out[3]!, 3));
  // out[4] = 5*0.5 + 3*0.5 = 4
  assert.ok(approx(out[4]!, 4));
});

test('a constant series yields a flat MACD of zero', () => {
  const closes = new Array(40).fill(100);
  const { macd, signal, histogram } = macdSeries(closes, 8, 17, 9);
  assert.ok(approx(macd.at(-1)!, 0));
  assert.ok(approx(signal.at(-1)!, 0));
  assert.ok(approx(histogram.at(-1)!, 0));
});

test('a rising series has a positive MACD (fast above slow)', () => {
  const closes = Array.from({ length: 60 }, (_, i) => 100 + i);
  const { macd } = macdSeries(closes, 8, 17, 9);
  assert.ok(macd.at(-1)! > 0, 'uptrend -> MACD above zero');
});

test('histogram equals macd minus signal where both defined', () => {
  const closes = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 3) * 5);
  const { macd, signal, histogram } = macdSeries(closes, 8, 17, 9);
  const i = closes.length - 1;
  assert.ok(approx(histogram[i]!, macd[i]! - signal[i]!));
});

test('stochastic pins to 100 at a new high and 0 at a new low', () => {
  const rising: Bar[] = Array.from({ length: 30 }, (_, i) => ({
    date: `d${i}`,
    open: 100 + i,
    high: 100 + i,
    low: 100 + i,
    close: 100 + i,
  }));
  const { percentK } = stochasticSeries(rising, 14, 1, 3); // kSmoothing 1 = raw
  assert.ok(percentK.at(-1)! > 99, 'monotonic rise -> %K near 100');
});

test('stochastic %K and %D are within [0,100] on real-ish data', () => {
  const bars: Bar[] = Array.from({ length: 60 }, (_, i) => {
    const c = 100 + Math.sin(i / 4) * 10;
    return { date: `d${i}`, open: c, high: c + 2, low: c - 2, close: c };
  });
  const { percentK, percentD } = stochasticSeries(bars, 14, 5, 3);
  for (const v of [percentK.at(-1)!, percentD.at(-1)!]) {
    assert.ok(v >= 0 && v <= 100, `expected 0..100, got ${v}`);
  }
});
