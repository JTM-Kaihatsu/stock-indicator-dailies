import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  ChartAcquisitionError,
  FakeChartAgent,
  PLACEHOLDER_PNG_BASE64,
  type ChartAgent,
} from '@stock-indicator-dailies/agent';
import type { VlmProvider, VlmRequest } from '@stock-indicator-dailies/vlm';
import type { Bar, DailyBarsResult, DataSource } from '@stock-indicator-dailies/indicators';

import { runEval } from '../src/harness.ts';

/** A provider that echoes a fixed verdict JSON; no network, no billing. */
class StubProvider implements VlmProvider {
  readonly name = 'stub';
  #json: string;
  constructor(readings: object[]) {
    this.#json = JSON.stringify({ ticker: 'X', signal: 'HOLD', readings });
  }
  async complete(_request: VlmRequest): Promise<string> {
    return this.#json;
  }
}

class ThrowingProvider implements VlmProvider {
  readonly name = 'throwing';
  async complete(): Promise<string> {
    throw new Error('provider exploded');
  }
}

/** Deterministic synthetic bars; enough length for every indicator to warm up. */
function fakeBars(n = 80): Bar[] {
  return Array.from({ length: n }, (_, i) => {
    const close = 100 + 20 * Math.sin(i / 5) + i * 0.1;
    return {
      date: new Date(2026, 0, 1 + i).toISOString().slice(0, 10),
      open: close,
      high: close + 1,
      low: close - 1,
      close,
    };
  });
}

class FakeDataSource implements DataSource {
  readonly name = 'fake';
  async fetchDailyBars(): Promise<DailyBarsResult> {
    return { bars: fakeBars() };
  }
}

/** A clock that advances 1s per read, so each stage measures a fixed 1s. */
function fakeClock() {
  let t = 0;
  return () => (t += 1000);
}

const READINGS = [
  { indicator: 'macd', crossover: 'BEARISH', barsAgo: 8, qualified: false, rationale: 'r' },
  { indicator: 'slowStochastic', crossover: 'BEARISH', barsAgo: 6, qualified: false, rationale: 'r' },
  { indicator: 'sma', crossover: 'BEARISH', barsAgo: 2, qualified: true, rationale: 'r' },
];

test('runEval grades each ticker against the oracle, fully offline', async () => {
  const run = await runEval(
    ['gev', 'nvda'],
    {
      agent: new FakeChartAgent(),
      provider: new StubProvider(READINGS),
      dataSource: new FakeDataSource(),
    },
    { now: fakeClock() },
  );

  assert.equal(run.results.length, 2);
  for (const r of run.results) {
    assert.equal(r.ok, true, r.error ?? 'expected ok');
    assert.equal(r.comparisons?.length, 3, 'one comparison per indicator');
    assert.equal(r.vlm?.length, 3, 'VLM read captured');
    assert.equal(r.fetched?.length, 3, 'fetched read captured');
    assert.equal(r.ticker, r.ticker.toUpperCase(), 'ticker normalized');
    assert.equal(r.totalMs, 2000, 'capture 1s + analyze 1s under the fake clock');
    assert.equal(r.withinTarget, true);
  }
  // Aggregate covers 2 charts × 3 indicators.
  assert.equal(run.summary.comparisons, 6);
  assert.equal(run.timing.withinTarget, 2);
  assert.equal(run.timing.medianTotalMs, 2000);
});

test('a capture failure is isolated to that ticker, not fatal to the run', async () => {
  const run = await runEval(
    ['bad', 'good'],
    {
      // FakeChartAgent fails uniformly; pair it with a working one is impossible,
      // so assert the failure path shapes correctly for the whole run.
      agent: new FakeChartAgent({ failWith: 'not-authenticated' }),
      provider: new StubProvider(READINGS),
      dataSource: new FakeDataSource(),
    },
    { now: fakeClock() },
  );

  assert.equal(run.results.length, 2);
  for (const r of run.results) {
    assert.equal(r.ok, false);
    assert.match(r.error ?? '', /^capture: not-authenticated/);
  }
  // Nothing graded, so aggregate denominators are empty (accuracy defaults to 1).
  assert.equal(run.summary.comparisons, 0);
  assert.equal(run.timing.withinTarget, 0);
});

/** An agent that rejects the chart but hands back the image it was rejected on. */
class RejectsWithImageAgent implements ChartAgent {
  readonly name = 'rejects-with-image';
  async acquire(): Promise<never> {
    throw new ChartAcquisitionError('studies-not-rendered', 'blank oscillator panes', {
      base64: PLACEHOLDER_PNG_BASE64,
      mediaType: 'image/png',
    });
  }
}

test('a failed capture still saves the diagnostic image when one is attached', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'eval-harness-'));
  const run = await runEval(
    ['vst'],
    {
      agent: new RejectsWithImageAgent(),
      provider: new StubProvider(READINGS),
      dataSource: new FakeDataSource(),
    },
    { now: fakeClock(), imageDir: dir },
  );

  const r = run.results[0]!;
  assert.equal(r.ok, false);
  assert.match(r.error ?? '', /^capture: studies-not-rendered/);
  assert.ok(r.imagePath, 'diagnostic image path is set');
  assert.ok(existsSync(r.imagePath!), 'diagnostic image was written to disk');
  assert.match(r.imagePath!, /VST\.FAILED\.png$/);
});

test('a provider error is captured as an analysis-stage failure', async () => {
  const run = await runEval(
    ['gev'],
    {
      agent: new FakeChartAgent(),
      provider: new ThrowingProvider(),
      dataSource: new FakeDataSource(),
    },
    { now: fakeClock() },
  );

  assert.equal(run.results[0]!.ok, false);
  assert.match(run.results[0]!.error ?? '', /^analysis: provider exploded/);
});
