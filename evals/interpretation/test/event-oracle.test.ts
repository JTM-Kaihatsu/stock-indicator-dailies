import test from 'node:test';
import assert from 'node:assert/strict';

import { detectCrossover } from '../src/crossovers.ts';
import { computeOracleReadings, computeLastBar } from '../src/event-oracle.ts';
import { calibrate } from '../src/calibrate.ts';
import type { Bar } from '../src/compute.ts';

// --- crossover detection ---

test('detects the most recent bullish crossover and its recency', () => {
  //          idx: 0    1    2    3    4    5
  const a = [1, 0, -1, 0, 2, 3]; // a − b flips negative→positive at idx 4
  const b = [0, 0, 0, 0, 0, 0];
  const x = detectCrossover(a, b);
  assert.equal(x.direction, 'BULLISH');
  assert.equal(x.atIndex, 4);
  assert.equal(x.barsAgo, 1); // last defined bar is idx 5
});

test('detects the most recent bearish crossover, ignoring older ones', () => {
  const a = [-1, 1, 2, 1, -1, -2]; // bullish at 1, then bearish at 4 (most recent)
  const b = [0, 0, 0, 0, 0, 0];
  const x = detectCrossover(a, b);
  assert.equal(x.direction, 'BEARISH');
  assert.equal(x.atIndex, 4);
  assert.equal(x.barsAgo, 1);
});

test('no sign change -> NONE', () => {
  const x = detectCrossover([1, 2, 3, 4], [0, 0, 0, 0]);
  assert.equal(x.direction, 'NONE');
  assert.equal(x.barsAgo, undefined);
});

// --- full oracle on a constructed series ---

/** A downtrend that recently turned up, so price crosses back above its SMA. */
function vShape(): Bar[] {
  const closes: number[] = [];
  for (let i = 0; i < 40; i++) closes.push(120 - i); // long decline
  for (let i = 0; i < 15; i++) closes.push(80 + i * 3); // sharp recovery
  return closes.map((c, i) => ({ date: `d${i}`, open: c, high: c + 1, low: c - 1, close: c }));
}

test('a V-shaped recovery yields a recent bullish SMA crossover', () => {
  const readings = computeOracleReadings(vShape());
  const smaReading = readings.find((r) => r.indicator === 'sma')!;
  assert.equal(smaReading.crossover, 'BULLISH');
  assert.ok(smaReading.barsAgo !== undefined && smaReading.barsAgo < 15);
});

test('oracle readings have the VLM fact shape', () => {
  const readings = computeOracleReadings(vShape());
  assert.equal(readings.length, 3);
  for (const r of readings) {
    assert.ok(['macd', 'slowStochastic', 'sma'].includes(r.indicator));
    assert.ok(['BULLISH', 'BEARISH', 'NONE'].includes(r.crossover));
    assert.equal(typeof r.qualified, 'boolean');
    if (r.crossover === 'NONE') assert.equal(r.barsAgo, undefined);
    else assert.equal(typeof r.barsAgo, 'number');
  }
});

// --- calibration ---

test('calibration passes when computed matches the legend', () => {
  const bars = vShape();
  const computed = computeLastBar(bars);
  // Feed the computed values back as the "legend" — must calibrate cleanly.
  const result = calibrate(computed, {
    macd: computed.macd,
    stochastic: computed.stochastic,
    sma: computed.sma,
    close: computed.close,
  });
  assert.equal(result.ok, true, JSON.stringify(result.fields.filter((f) => !f.ok)));
});

test('calibration fails loudly on a data mismatch', () => {
  const bars = vShape();
  const computed = computeLastBar(bars);
  const result = calibrate(computed, {
    macd: computed.macd,
    stochastic: computed.stochastic,
    sma: computed.sma * 1.1, // 10% off — a wrong data source
    close: computed.close,
  });
  assert.equal(result.ok, false);
  assert.ok(result.fields.find((f) => f.field === 'sma' && !f.ok));
});
