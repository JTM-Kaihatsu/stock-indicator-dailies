import test from 'node:test';
import assert from 'node:assert/strict';

import { SUCCESS_TARGETS } from '@stock-indicator-dailies/shared';
import { FakeChartAgent } from '@stock-indicator-dailies/agent';
import type { VlmProvider, VlmRequest } from '@stock-indicator-dailies/vlm';

import type { DataSource } from '@stock-indicator-dailies/indicators';

import { runDaily } from '../src/run-daily.ts';

/** VLM provider returning a canned response — no network, no key. */
class FakeProvider implements VlmProvider {
  readonly name = 'fake';
  readonly #response: string;
  constructor(response: string) {
    this.#response = response;
  }
  async complete(_request: VlmRequest): Promise<string> {
    return this.#response;
  }
}

/** Fake OHLC source so tests never hit the network. */
const fakeBars = Array.from({ length: 60 }, (_, i) => {
  const c = 100 + (i % 7);
  return { date: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`, open: c, high: c + 1, low: c - 1, close: c };
});
const fakeSource = { name: 'fake', async fetchDailyBars() { return fakeBars; } };

const sellJson = JSON.stringify({
  ticker: 'GEV',
  signal: 'SELL',
  visibleRange: 'Dec 2025 to Aug 2026',
  readings: [
    { indicator: 'macd', crossover: 'BEARISH', qualified: true, barsAgo: 1 },
    { indicator: 'slowStochastic', crossover: 'NONE', qualified: false },
    { indicator: 'sma', crossover: 'BEARISH', qualified: true, barsAgo: 2 },
  ],
});

/** Deterministic clock: advances a fixed step on every read. */
function stepClock(stepMs: number) {
  let t = 0;
  return () => {
    const value = t;
    t += stepMs;
    return value;
  };
}

test('happy path returns a verdict, the source image, and timings', async () => {
  const result = await runDaily(
    { ticker: 'gev', agent: new FakeChartAgent(), provider: new FakeProvider(sellJson), dataSource: fakeSource as DataSource },
    { now: stepClock(1000) },
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  const { report } = result;
  assert.equal(report.ticker, 'GEV');
  assert.equal(report.verdict.signal, 'SELL'); // two SELL meets sellConsensus
  assert.equal(report.verdict.visibleRange, 'Dec 2025 to Aug 2026');
  assert.ok(report.image.base64.length > 0, 'source image is returned for verification');
  assert.deepEqual(report.warnings, []);
  assert.ok(report.timings.totalMs > 0);
  assert.equal(report.timings.withinTarget, true);
  assert.ok(report.deterministic, 'deterministic read present');
  assert.equal(report.deterministic!.source, 'fake');
  assert.equal(report.deterministic!.readings.length, 3);
});

test('ticker is upper-cased and passed to the agent', async () => {
  const agent = new FakeChartAgent();
  await runDaily({ ticker: 'gev', agent, provider: new FakeProvider(sellJson) });
  assert.deepEqual(agent.requested, ['GEV']);
});

test('capture failure is reported with its reason, not thrown', async () => {
  const result = await runDaily({
    ticker: 'GEV',
    agent: new FakeChartAgent({ failWith: 'not-authenticated' }),
    provider: new FakeProvider(sellJson),
    dataSource: fakeSource as DataSource,
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.stage, 'capture');
  assert.equal(result.reason, 'not-authenticated');
  assert.match(result.errors[0]!, /not-authenticated/);
});

test('a wrong-interval capture fails before any model call', async () => {
  let called = false;
  const provider: VlmProvider = {
    name: 'spy',
    async complete() {
      called = true;
      return sellJson;
    },
  };
  const result = await runDaily({
    ticker: 'GEV',
    agent: new FakeChartAgent({ failWith: 'wrong-interval' }),
    provider,
    dataSource: fakeSource as DataSource,
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, 'wrong-interval');
  assert.equal(called, false, 'must not spend a model call on a bad capture');
});

test('unparseable model output is reported as an analysis failure', async () => {
  const result = await runDaily({
    ticker: 'GEV',
    agent: new FakeChartAgent(),
    provider: new FakeProvider('I could not read the chart.'),
    dataSource: fakeSource as DataSource,
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.stage, 'analysis');
  assert.equal(result.reason, 'invalid-verdict');
  assert.match(result.errors.join('\n'), /no JSON object found/);
});

test('model disagreement surfaces as a warning, derived signal wins', async () => {
  const disagrees = JSON.stringify({
    ticker: 'GEV',
    signal: 'HOLD',
    readings: [
      { indicator: 'macd', crossover: 'BEARISH', qualified: true, barsAgo: 1 },
      { indicator: 'slowStochastic', crossover: 'BEARISH', qualified: true, barsAgo: 1 },
      { indicator: 'sma', crossover: 'NONE', qualified: false },
    ],
  });
  const result = await runDaily({
    ticker: 'GEV',
    agent: new FakeChartAgent(),
    provider: new FakeProvider(disagrees),
    dataSource: fakeSource as DataSource,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.report.verdict.signal, 'SELL');
  assert.match(result.report.warnings.join('\n'), /disagreed/);
});

test('a slow run is flagged against the time-to-signal target', async () => {
  const slow = stepClock(SUCCESS_TARGETS.timeToSignalMs);
  const result = await runDaily(
    { ticker: 'GEV', agent: new FakeChartAgent(), provider: new FakeProvider(sellJson), dataSource: fakeSource as DataSource },
    { now: slow },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.report.timings.withinTarget, false);
});

test('consensus options flow through to the derived signal', async () => {
  const twoBuys = JSON.stringify({
    ticker: 'GEV',
    readings: [
      { indicator: 'macd', crossover: 'BULLISH', qualified: true, barsAgo: 1 },
      { indicator: 'slowStochastic', crossover: 'BULLISH', qualified: true, barsAgo: 1 },
      { indicator: 'sma', crossover: 'NONE', qualified: false },
    ],
  });
  const strict = await runDaily({
    ticker: 'GEV',
    agent: new FakeChartAgent(),
    provider: new FakeProvider(twoBuys),
    dataSource: fakeSource as DataSource,
  });
  assert.equal(strict.ok && strict.report.verdict.signal, 'HOLD');

  const loose = await runDaily(
    { ticker: 'GEV', agent: new FakeChartAgent(), provider: new FakeProvider(twoBuys), dataSource: fakeSource as DataSource },
    { buyConsensus: 2 },
  );
  assert.equal(loose.ok && loose.report.verdict.signal, 'BUY');
});
