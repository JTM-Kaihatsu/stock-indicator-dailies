import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { Bar } from '@stock-indicator-dailies/indicators';
import type { Signal } from '@stock-indicator-dailies/shared';

import { applyStrategy } from '../src/simulate.ts';

function bar(date: string, close: number): Bar {
  return { date, open: close, high: close, low: close, close };
}

test('a BUY then SELL realizes the price move, compounding into the next trade', () => {
  // signals[i] corresponds to bars[i + 1]: BUY -> bars[1]=100, SELL -> bars[2]=120.
  const bars = [bar('d0', 90), bar('d1', 100), bar('d2', 120)];
  const signals: Signal[] = ['BUY', 'SELL'];

  const result = applyStrategy('T', bars, signals, 10_000);

  assert.equal(result.trades.length, 2);
  assert.equal(result.trades[0]!.type, 'BUY');
  assert.equal(result.trades[0]!.price, 100);
  assert.equal(result.trades[1]!.type, 'SELL');
  assert.equal(result.trades[1]!.price, 120);
  assert.equal(result.stillHolding, false);
  // 10,000 -> 100 shares at $100 -> 12,000 at $120 -> +20%
  assert.equal(result.finalValue, 12_000);
  assert.ok(Math.abs(result.strategyReturnPct - 20) < 1e-9);
});

test('an open position at the end is marked to market, not force-closed', () => {
  // signals[0] -> bars[1]=100 (BUY), signals[1] -> bars[2]=150 (HOLD, still open).
  const bars = [bar('d0', 90), bar('d1', 100), bar('d2', 150)];
  const signals: Signal[] = ['BUY', 'HOLD'];

  const result = applyStrategy('T', bars, signals, 10_000);

  assert.equal(result.trades.length, 1);
  assert.equal(result.stillHolding, true);
  // 100 shares at $100, marked at the final close of $150
  assert.equal(result.finalValue, 15_000);
  assert.ok(Math.abs(result.strategyReturnPct - 50) < 1e-9);
});

test('a second consecutive BUY signal while already holding is a no-op', () => {
  const bars = [bar('d0', 100), bar('d1', 100), bar('d2', 110), bar('d3', 120)];
  const signals: Signal[] = ['BUY', 'BUY', 'BUY'];

  const result = applyStrategy('T', bars, signals, 10_000);

  assert.equal(result.trades.length, 1, 'only the first BUY should execute — no pyramiding');
});

test('a SELL signal with nothing held is a no-op', () => {
  const bars = [bar('d0', 100), bar('d1', 100), bar('d2', 90)];
  const signals: Signal[] = ['SELL', 'SELL'];

  const result = applyStrategy('T', bars, signals, 10_000);

  assert.equal(result.trades.length, 0);
  assert.equal(result.finalValue, 10_000);
  assert.equal(result.strategyReturnPct, 0);
});

test('buy-and-hold baseline compares the first and last bar regardless of trades', () => {
  const bars = [bar('d0', 50), bar('d1', 50), bar('d2', 75)];
  const signals: Signal[] = ['HOLD', 'HOLD'];

  const result = applyStrategy('T', bars, signals, 10_000);

  assert.ok(Math.abs(result.buyAndHoldReturnPct - 50) < 1e-9);
});

test('rejects a signals array of the wrong length', () => {
  const bars = [bar('d0', 100), bar('d1', 100), bar('d2', 100)];
  assert.throws(() => applyStrategy('T', bars, ['HOLD'], 10_000));
});

test('rejects fewer than 2 bars', () => {
  assert.throws(() => applyStrategy('T', [bar('d0', 100)], [], 10_000));
});
