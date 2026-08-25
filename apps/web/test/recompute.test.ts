import { test } from 'node:test';
import assert from 'node:assert/strict';

import { recomputeReport, type IndicatorReading } from '@stock-indicator-dailies/shared';

import { DEFAULT_SETTINGS, toLiveOptions, type IndicatorSettings } from '../src/lib/settings.ts';
import type { DailyReport } from '../src/types/api.ts';

function bearishReading(barsAgo: number): IndicatorReading {
  return { indicator: 'macd', crossover: 'BEARISH', qualified: true, barsAgo };
}

function fixtureReport(barsAgo: number): DailyReport {
  const readings = [bearishReading(barsAgo), { ...bearishReading(barsAgo), indicator: 'slowStochastic' as const }, { ...bearishReading(barsAgo), indicator: 'sma' as const }];
  return {
    ticker: 'TEST',
    verdict: { ticker: 'TEST', signal: 'HOLD', readings },
    deterministic: {
      readings,
      signal: 'HOLD',
      values: { macd: { macd: 0, signal: 0, histogram: 0 }, stochastic: { percentK: 0, percentD: 0 }, sma: 0, close: 0 },
      source: 'fake',
      asOf: '2026-01-01',
      bars: 10,
    },
    warnings: [],
    timings: { captureMs: 0, analyzeMs: 0, deterministicMs: 0, totalMs: 0, withinTarget: true },
    image: { base64: '', mediaType: 'image/png' },
    raw: '',
  };
}

test('recompute derives SELL when 3 unanimous bearish readings are within the recency window', () => {
  const report = fixtureReport(2);
  const settings: IndicatorSettings = { ...DEFAULT_SETTINGS, recencyDays: 5 };
  const result = recomputeReport(report, toLiveOptions(settings));
  assert.equal(result.verdict.signal, 'SELL');
  assert.equal(result.deterministic!.signal, 'SELL');
});

test('recompute derives HOLD once recencyDays shrinks past the readings\' barsAgo', () => {
  const report = fixtureReport(2);
  const settings: IndicatorSettings = { ...DEFAULT_SETTINGS, recencyDays: 1 };
  const result = recomputeReport(report, toLiveOptions(settings));
  assert.equal(result.verdict.signal, 'HOLD');
  assert.equal(result.deterministic!.signal, 'HOLD');
});

test('recompute with DEFAULT_SETTINGS matches what the backend already computed for default-consistent data', () => {
  // barsAgo=1, well within the default 3-day recency window, unanimous
  // bearish across all three -> SELL under the default sellConsensus=3.
  const report = fixtureReport(1);
  const result = recomputeReport(report, toLiveOptions(DEFAULT_SETTINGS));
  assert.equal(result.verdict.signal, 'SELL');
});

test('recompute leaves readings, image, warnings, and timings untouched', () => {
  const report = fixtureReport(2);
  const result = recomputeReport(report, toLiveOptions({ ...DEFAULT_SETTINGS, recencyDays: 1 }));
  assert.deepEqual(result.verdict.readings, report.verdict.readings);
  assert.deepEqual(result.image, report.image);
  assert.deepEqual(result.warnings, report.warnings);
  assert.deepEqual(result.timings, report.timings);
});

test('recompute is a no-op passthrough when deterministic is absent', () => {
  const report = fixtureReport(2);
  const { deterministic: _drop, ...withoutDeterministic } = report;
  const result = recomputeReport(withoutDeterministic as DailyReport, toLiveOptions(DEFAULT_SETTINGS));
  assert.equal(result.deterministic, undefined);
});
