import test from 'node:test';
import assert from 'node:assert/strict';

import {
  combineSignals,
  deriveIndicatorSignal,
  deriveSignal,
  resolveDualOverall,
  tallySignals,
} from '../src/signal.ts';
import type { IndicatorReading } from '../src/types.ts';

// --- deriveIndicatorSignal: facts -> signal, with the recency window ---

/** Build one indicator reading (facts). */
function reading(fields: Partial<IndicatorReading>): IndicatorReading {
  return { indicator: 'macd', crossover: 'NONE', qualified: false, ...fields };
}

test('a recent, qualified bullish crossover -> BUY', () => {
  assert.equal(
    deriveIndicatorSignal(reading({ crossover: 'BULLISH', qualified: true, barsAgo: 1 })),
    'BUY',
  );
});

test('a recent, qualified bearish crossover -> SELL', () => {
  assert.equal(
    deriveIndicatorSignal(reading({ crossover: 'BEARISH', qualified: true, barsAgo: 0 })),
    'SELL',
  );
});

test('no crossover -> NEUTRAL', () => {
  assert.equal(deriveIndicatorSignal(reading({ crossover: 'NONE' })), 'NEUTRAL');
});

test('an unqualified crossover (wrong zone/slope) -> NEUTRAL', () => {
  assert.equal(
    deriveIndicatorSignal(reading({ crossover: 'BULLISH', qualified: false, barsAgo: 1 })),
    'NEUTRAL',
  );
});

test('a stale crossover (beyond the recency window) -> NEUTRAL', () => {
  assert.equal(
    deriveIndicatorSignal(reading({ crossover: 'BULLISH', qualified: true, barsAgo: 4 })),
    'NEUTRAL',
  );
});

test('barsAgo exactly on the window boundary still counts', () => {
  assert.equal(
    deriveIndicatorSignal(reading({ crossover: 'BULLISH', qualified: true, barsAgo: 3 })),
    'BUY',
  );
});

test('recency window is configurable', () => {
  const stale = reading({ crossover: 'BEARISH', qualified: true, barsAgo: 5 });
  assert.equal(deriveIndicatorSignal(stale, { recencyDays: 3 }), 'NEUTRAL');
  assert.equal(deriveIndicatorSignal(stale, { recencyDays: 7 }), 'SELL');
});

// --- combineSignals: asymmetric consensus (BUY needs 2, SELL needs 3) ---

test('tallySignals counts each bucket', () => {
  assert.deepEqual(tallySignals(['BUY', 'SELL', 'NEUTRAL']), { buys: 1, sells: 1, neutrals: 1 });
});

test('three BUYs -> BUY', () => {
  assert.equal(combineSignals(['BUY', 'BUY', 'BUY']), 'BUY');
});

test('two BUYs -> BUY (BUY needs only two of three)', () => {
  assert.equal(combineSignals(['BUY', 'BUY', 'NEUTRAL']), 'BUY');
});

test('one BUY -> HOLD (BUY needs at least two)', () => {
  assert.equal(combineSignals(['BUY', 'NEUTRAL', 'NEUTRAL']), 'HOLD');
});

test('two SELLs -> HOLD (SELL needs all three)', () => {
  assert.equal(combineSignals(['SELL', 'SELL', 'BUY']), 'HOLD');
});

test('three SELLs -> SELL (unanimity)', () => {
  assert.equal(combineSignals(['SELL', 'SELL', 'SELL']), 'SELL');
});

test('one SELL -> HOLD', () => {
  assert.equal(combineSignals(['SELL', 'BUY', 'NEUTRAL']), 'HOLD');
});

test('SELL wins over BUY when custom thresholds overlap', () => {
  assert.equal(combineSignals(['SELL', 'SELL', 'BUY'], { buyConsensus: 1, sellConsensus: 2 }), 'SELL');
});

// --- deriveSignal: full path, facts -> overall ---

/** Standard 3-indicator fact set from directional shorthand. */
function facts(
  macd: IndicatorReading['crossover'],
  stoch: IndicatorReading['crossover'],
  sma: IndicatorReading['crossover'],
): IndicatorReading[] {
  const one = (
    indicator: IndicatorReading['indicator'],
    crossover: IndicatorReading['crossover'],
  ): IndicatorReading =>
    crossover === 'NONE'
      ? { indicator, crossover, qualified: false }
      : { indicator, crossover, qualified: true, barsAgo: 1 };
  return [one('macd', macd), one('slowStochastic', stoch), one('sma', sma)];
}

test('three recent bearish crossovers -> SELL', () => {
  assert.equal(deriveSignal(facts('BEARISH', 'BEARISH', 'BEARISH')), 'SELL');
});

test('two bearish + one none -> HOLD (SELL needs all three)', () => {
  assert.equal(deriveSignal(facts('BEARISH', 'BEARISH', 'NONE')), 'HOLD');
});

test('three recent bullish crossovers -> BUY', () => {
  assert.equal(deriveSignal(facts('BULLISH', 'BULLISH', 'BULLISH')), 'BUY');
});

test('two bullish + one none -> BUY (BUY needs only two of three)', () => {
  assert.equal(deriveSignal(facts('BULLISH', 'BULLISH', 'NONE')), 'BUY');
});

test('stale crossovers do not fire', () => {
  const stale: IndicatorReading[] = [
    { indicator: 'macd', crossover: 'BEARISH', qualified: true, barsAgo: 10 },
    { indicator: 'slowStochastic', crossover: 'BEARISH', qualified: true, barsAgo: 10 },
    { indicator: 'sma', crossover: 'NONE', qualified: false },
  ];
  assert.equal(deriveSignal(stale), 'HOLD');
});

// --- resolveDualOverall: the full 9-cell (computed, AI) truth table ---
// Agreement is trivial (the shared value wins); a disagreement where one
// side is HOLD lets the decisive side win; a direct BUY-vs-SELL
// contradiction settles to HOLD rather than picking a side.

test('agreement: both HOLD -> HOLD', () => {
  assert.equal(resolveDualOverall('HOLD', 'HOLD'), 'HOLD');
});

test('agreement: both BUY -> BUY', () => {
  assert.equal(resolveDualOverall('BUY', 'BUY'), 'BUY');
});

test('agreement: both SELL -> SELL', () => {
  assert.equal(resolveDualOverall('SELL', 'SELL'), 'SELL');
});

test('computed HOLD, AI BUY -> BUY (the decisive side wins over neutral)', () => {
  assert.equal(resolveDualOverall('HOLD', 'BUY'), 'BUY');
});

test('computed BUY, AI HOLD -> BUY', () => {
  assert.equal(resolveDualOverall('BUY', 'HOLD'), 'BUY');
});

test('computed HOLD, AI SELL -> SELL', () => {
  assert.equal(resolveDualOverall('HOLD', 'SELL'), 'SELL');
});

test('computed SELL, AI HOLD -> SELL', () => {
  assert.equal(resolveDualOverall('SELL', 'HOLD'), 'SELL');
});

test('computed BUY, AI SELL -> HOLD (direct contradiction, not a lean toward SELL)', () => {
  assert.equal(resolveDualOverall('BUY', 'SELL'), 'HOLD');
});

test('computed SELL, AI BUY -> HOLD', () => {
  assert.equal(resolveDualOverall('SELL', 'BUY'), 'HOLD');
});

test('AI null means no read yet at all -> null, regardless of computed', () => {
  assert.equal(resolveDualOverall('BUY', null), null);
  assert.equal(resolveDualOverall(null, null), null);
});

test('computed null (data fetch failed) but AI present -> the AI read alone', () => {
  assert.equal(resolveDualOverall(null, 'SELL'), 'SELL');
  assert.equal(resolveDualOverall(null, 'HOLD'), 'HOLD');
});
