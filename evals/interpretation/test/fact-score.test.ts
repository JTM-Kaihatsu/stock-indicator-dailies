import test from 'node:test';
import assert from 'node:assert/strict';

import type { IndicatorKey, IndicatorReading } from '@stock-indicator-dailies/shared';

import { compareReadings, summarize } from '../src/fact-score.ts';

const reading = (
  indicator: IndicatorKey,
  crossover: IndicatorReading['crossover'],
  barsAgo: number | undefined,
  qualified: boolean,
): IndicatorReading => ({
  indicator,
  crossover,
  qualified,
  ...(crossover !== 'NONE' && barsAgo !== undefined ? { barsAgo } : {}),
});

test('the GEV SMA case: same direction, barsAgo gap straddles the recency window', () => {
  // VLM: bearish 2d ago, qualified -> SELL (2 <= 3). Fetched: bearish 5d -> NEUTRAL (5 > 3).
  const vlm = [reading('sma', 'BEARISH', 2, true)];
  const fetched = [reading('sma', 'BEARISH', 5, true)];

  const [c] = compareReadings(vlm, fetched);
  assert.equal(c!.directionMatch, true, 'directions agree');
  assert.equal(c!.bothCrossed, true);
  assert.equal(c!.barsAgoGap, 3, 'a 3-bar timing gap');
  assert.equal(c!.qualifiedMatch, true);
  assert.equal(c!.vlmSignal, 'SELL');
  assert.equal(c!.fetchedSignal, 'NEUTRAL');
  assert.equal(c!.signalMatch, false, 'the timing gap flips the derived signal');
});

test('a missing VLM indicator is a NONE reading, not skipped', () => {
  const fetched = [reading('macd', 'BULLISH', 1, true)];
  const [c] = compareReadings([], fetched);
  assert.equal(c!.vlm.crossover, 'NONE');
  assert.equal(c!.directionMatch, false);
  assert.equal(c!.bothCrossed, false);
  assert.equal(c!.barsAgoGap, undefined, 'no barsAgo gap when one side did not cross');
  assert.equal(c!.vlmSignal, 'NEUTRAL');
});

test('both NONE counts as a direction match with no barsAgo comparison', () => {
  const [c] = compareReadings([reading('sma', 'NONE', undefined, false)], [
    reading('sma', 'NONE', undefined, false),
  ]);
  assert.equal(c!.directionMatch, true);
  assert.equal(c!.bothCrossed, false);
  assert.equal(c!.signalMatch, true);
});

test('summarize rolls up overall and per-indicator agreement rates', () => {
  const comparisons = compareReadings(
    [
      reading('macd', 'BULLISH', 1, true), // direction ✓, gap 0
      reading('slowStochastic', 'BULLISH', 4, true), // direction ✗ (fetched bearish)
      reading('sma', 'BEARISH', 2, true), // direction ✓, gap 3
    ],
    [
      reading('macd', 'BULLISH', 1, true),
      reading('slowStochastic', 'BEARISH', 3, true),
      reading('sma', 'BEARISH', 5, true),
    ],
  );

  const s = summarize(comparisons);
  assert.equal(s.comparisons, 3);
  assert.equal(Math.round(s.directionAgreement * 100), 67, '2 of 3 directions agree');
  // barsAgo gaps only where both crossed: macd Δ0, stoch Δ1 (both crossed), sma Δ3
  assert.equal(s.barsAgo.n, 3);
  assert.equal(s.barsAgo.max, 3);
  assert.equal(s.perIndicator.macd.directionAgreement, 1);
  assert.equal(s.perIndicator.slowStochastic.directionAgreement, 0);
  assert.equal(s.perIndicator.sma.barsAgo.mean, 3);
});
