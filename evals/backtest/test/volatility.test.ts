import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { Bar } from '@stock-indicator-dailies/indicators';

import { adx, atr } from '../src/volatility.ts';

function bar(date: string, close: number, extra: Partial<Bar> = {}): Bar {
  return { date, open: close, high: close, low: close, close, ...extra };
}

test('atr is NaN before the warmup period, defined after', () => {
  const bars = Array.from({ length: 20 }, (_, i) => bar(`d${i}`, 100 + i, { high: 101 + i, low: 99 + i }));
  const series = atr(bars, 14);
  for (let i = 0; i < 14; i++) assert.ok(Number.isNaN(series[i]));
  for (let i = 14; i < bars.length; i++) assert.ok(!Number.isNaN(series[i]));
});

test('atr reflects a constant true range once warmed up', () => {
  // Every bar has the same 2-point high/low range and a 1-point close-to-close
  // move -> true range settles to a constant 2.
  const bars = Array.from({ length: 20 }, (_, i) => bar(`d${i}`, 100 + i, { high: 101 + i, low: 99 + i }));
  const series = atr(bars, 14);
  assert.ok(Math.abs(series[19]! - 2) < 1e-9);
});

test('adx is NaN before its warmup period', () => {
  const bars = Array.from({ length: 20 }, (_, i) => bar(`d${i}`, 100 + i, { high: 101 + i, low: 99 + i }));
  const series = adx(bars, 14);
  assert.ok(series.every((v) => Number.isNaN(v)), 'needs ~2x period bars, none available yet');
});

test('adx reads high for a clean, consistent trend', () => {
  const bars = Array.from({ length: 45 }, (_, i) => bar(`d${i}`, 100 + i, { high: 100.5 + i, low: 99.5 + i }));
  const series = adx(bars, 14);
  const last = series[series.length - 1]!;
  assert.ok(!Number.isNaN(last));
  assert.ok(last > 50, `expected a strong trend reading, got ${last}`);
});

test('adx reads low for a flat, directionless series', () => {
  const bars = Array.from({ length: 45 }, (_, i) => {
    const wiggle = i % 2 === 0 ? 0.1 : -0.1;
    return bar(`d${i}`, 100 + wiggle, { high: 100.5, low: 99.5 });
  });
  const series = adx(bars, 14);
  const last = series[series.length - 1]!;
  assert.ok(!Number.isNaN(last));
  assert.ok(last < 30, `expected a weak trend reading for chop, got ${last}`);
});
