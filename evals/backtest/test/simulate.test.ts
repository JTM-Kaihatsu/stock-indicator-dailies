import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { Bar } from '@stock-indicator-dailies/indicators';
import type { Signal } from '@stock-indicator-dailies/shared';

import { applyStrategy } from '../src/simulate.ts';

function bar(date: string, close: number, extra: Partial<Bar> = {}): Bar {
  return { date, open: close, high: close, low: close, close, ...extra };
}

test('a BUY then SELL realizes the price move, compounding into the next trade', () => {
  // signals[i] corresponds to bars[i + 1]: BUY -> bars[1]=100, SELL -> bars[2]=120.
  const bars = [bar('d0', 90), bar('d1', 100), bar('d2', 120)];
  const signals: Signal[] = ['BUY', 'SELL'];

  const result = applyStrategy('T', bars, signals, { startingCapital: 10_000 });

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

  const result = applyStrategy('T', bars, signals, { startingCapital: 10_000 });

  assert.equal(result.trades.length, 1);
  assert.equal(result.stillHolding, true);
  // 100 shares at $100, marked at the final close of $150
  assert.equal(result.finalValue, 15_000);
  assert.ok(Math.abs(result.strategyReturnPct - 50) < 1e-9);
});

test('a second consecutive BUY signal while already holding is a no-op', () => {
  const bars = [bar('d0', 100), bar('d1', 100), bar('d2', 110), bar('d3', 120)];
  const signals: Signal[] = ['BUY', 'BUY', 'BUY'];

  const result = applyStrategy('T', bars, signals, { startingCapital: 10_000 });

  assert.equal(result.trades.length, 1, 'only the first BUY should execute; no pyramiding');
});

test('a SELL signal with nothing held is a no-op', () => {
  const bars = [bar('d0', 100), bar('d1', 100), bar('d2', 90)];
  const signals: Signal[] = ['SELL', 'SELL'];

  const result = applyStrategy('T', bars, signals, { startingCapital: 10_000 });

  assert.equal(result.trades.length, 0);
  assert.equal(result.finalValue, 10_000);
  assert.equal(result.strategyReturnPct, 0);
});

test('buy-and-hold baseline compares the first and last bar regardless of trades', () => {
  const bars = [bar('d0', 50), bar('d1', 50), bar('d2', 75)];
  const signals: Signal[] = ['HOLD', 'HOLD'];

  const result = applyStrategy('T', bars, signals, { startingCapital: 10_000 });

  assert.ok(Math.abs(result.buyAndHoldReturnPct - 50) < 1e-9);
});

test('rejects a signals array of the wrong length', () => {
  const bars = [bar('d0', 100), bar('d1', 100), bar('d2', 100)];
  assert.throws(() => applyStrategy('T', bars, ['HOLD']));
});

test('rejects fewer than 2 bars', () => {
  assert.throws(() => applyStrategy('T', [bar('d0', 100)], []));
});

// --- persistenceBars: require the raw signal to repeat before acting ---

test('persistenceBars=1 (default) acts on the first occurrence', () => {
  const bars = [bar('d0', 90), bar('d1', 100), bar('d2', 110)];
  const signals: Signal[] = ['BUY', 'HOLD'];
  const result = applyStrategy('T', bars, signals, {});
  assert.equal(result.trades.length, 1);
});

test('persistenceBars=3 suppresses a signal that only appears for 2 bars', () => {
  const bars = [bar('d0', 90), bar('d1', 100), bar('d2', 105), bar('d3', 90)];
  const signals: Signal[] = ['BUY', 'BUY', 'HOLD']; // BUY held for 2 bars, not 3
  const result = applyStrategy('T', bars, signals, { persistenceBars: 3 });
  assert.equal(result.trades.length, 0, 'BUY never persisted long enough to act on');
});

test('persistenceBars=3 acts once the signal has repeated 3 times, at the 3rd bar\'s price', () => {
  const bars = [bar('d0', 90), bar('d1', 91), bar('d2', 92), bar('d3', 93)];
  const signals: Signal[] = ['BUY', 'BUY', 'BUY'];
  const result = applyStrategy('T', bars, signals, { persistenceBars: 3 });
  assert.equal(result.trades.length, 1);
  assert.equal(result.trades[0]!.price, 93); // bars[3], the 3rd consecutive BUY
});

// --- minHoldingDays: a SELL can't fire before the position has aged enough ---

test('a SELL within the minimum holding period is suppressed, position stays open', () => {
  const bars = [bar('d0', 90), bar('d1', 100), bar('d2', 80), bar('d3', 70)];
  const signals: Signal[] = ['BUY', 'SELL', 'HOLD'];
  const result = applyStrategy('T', bars, signals, { minHoldingDays: 5 });
  assert.equal(result.trades.length, 1, 'only the BUY executes; the SELL 1 bar later is too soon');
  assert.equal(result.stillHolding, true);
});

test('a SELL after the minimum holding period executes normally', () => {
  const bars = [bar('d0', 90), bar('d1', 100), bar('d2', 95), bar('d3', 80)];
  const signals: Signal[] = ['BUY', 'HOLD', 'SELL'];
  const result = applyStrategy('T', bars, signals, { minHoldingDays: 2 });
  assert.equal(result.trades.length, 2);
  assert.equal(result.trades[1]!.type, 'SELL');
});

// --- ATR noise-reduction filter ---

test('a SELL is suppressed while the drop from the post-entry peak stays under the ATR multiple', () => {
  // Small daily ranges -> small ATR. Price dips only slightly off the peak.
  const bars = [
    bar('d0', 99, { high: 100, low: 98 }),
    bar('d1', 100, { high: 101, low: 99 }), // BUY here
    bar('d2', 102, { high: 103, low: 101 }), // new peak
    bar('d3', 101, { high: 102, low: 100 }), // SELL signal, but only $1 off the peak
  ];
  const signals: Signal[] = ['BUY', 'HOLD', 'SELL'];
  const result = applyStrategy('T', bars, signals, { atrMultiplier: 5, atrPeriod: 1 });
  assert.equal(result.trades.length, 1, 'the shallow pullback is noise relative to a 5x ATR requirement');
  assert.equal(result.stillHolding, true);
});

test('a SELL executes once the drop from peak clears the ATR multiple', () => {
  const bars = [
    bar('d0', 99, { high: 100, low: 98 }),
    bar('d1', 100, { high: 101, low: 99 }), // BUY here, ATR ~= 1
    bar('d2', 102, { high: 103, low: 101 }), // new peak
    bar('d3', 80, { high: 83, low: 79 }), // sharp drop, well past 5x ATR
  ];
  const signals: Signal[] = ['BUY', 'HOLD', 'SELL'];
  const result = applyStrategy('T', bars, signals, { atrMultiplier: 5, atrPeriod: 1 });
  assert.equal(result.trades.length, 2);
  assert.equal(result.trades[1]!.type, 'SELL');
});

// --- ADX trend-strength gate ---

// A steady $1/day uptrend with a constant true range of 1; ADX's ~27-bar
// (2 * default period 14) warmup needs to be cleared before the gate has a
// real (non-NaN) value to check, so the BUY signal is placed well past it.
const trendingBars = Array.from({ length: 45 }, (_, i) => bar(`d${i}`, 100 + i));
const buyAtBar36: Signal[] = Array.from({ length: 44 }, (_, i) => (i === 35 ? 'BUY' : 'HOLD'));

test('adxThreshold=0 never suppresses (degenerate case, sanity check the gate is wired up)', () => {
  const result = applyStrategy('T', trendingBars, buyAtBar36, { adxThreshold: 0 });
  assert.equal(result.trades.length, 1);
});

test('an impossibly high adxThreshold suppresses every trade', () => {
  const result = applyStrategy('T', trendingBars, buyAtBar36, { adxThreshold: 1000 });
  assert.equal(result.trades.length, 0);
});
