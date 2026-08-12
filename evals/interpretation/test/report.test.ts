import test from 'node:test';
import assert from 'node:assert/strict';

import { FakeChartAgent } from '@stock-indicator-dailies/agent';
import type { VlmProvider, VlmRequest } from '@stock-indicator-dailies/vlm';
import type { Bar, DataSource } from '@stock-indicator-dailies/indicators';

import { runEval } from '../src/harness.ts';
import { formatReport } from '../src/report.ts';
import { toCsv } from '../src/csv.ts';

class StubProvider implements VlmProvider {
  readonly name = 'stub';
  async complete(_r: VlmRequest): Promise<string> {
    return JSON.stringify({
      ticker: 'X',
      signal: 'HOLD',
      readings: [
        { indicator: 'macd', crossover: 'BEARISH', barsAgo: 8, qualified: false },
        { indicator: 'slowStochastic', crossover: 'NONE', qualified: false },
        { indicator: 'sma', crossover: 'BEARISH', barsAgo: 2, qualified: true },
      ],
    });
  }
}

class FakeDataSource implements DataSource {
  readonly name = 'fake';
  async fetchDailyBars(): Promise<Bar[]> {
    return Array.from({ length: 80 }, (_, i) => {
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
}

async function sampleRun() {
  let t = 0;
  return runEval(
    ['gev', 'bad'],
    {
      agent: new FakeChartAgent(),
      provider: new StubProvider(),
      dataSource: new FakeDataSource(),
    },
    { now: () => (t += 1000) },
  );
}

test('formatReport renders a run without throwing and covers both sections', async () => {
  const text = formatReport(await sampleRun());
  assert.match(text, /interpretation eval/);
  assert.match(text, /agreement/);
  assert.match(text, /direction/);
  assert.match(text, /barsAgo mean/);
  assert.match(text, /time-to-signal/);
  // Every ticker gets a line.
  assert.match(text, /GEV/);
  assert.match(text, /BAD/);
});

test('toCsv emits a header, both reads, and blank truth columns', async () => {
  const csv = toCsv(await sampleRun());
  const lines = csv.trim().split('\n');
  const header = lines[0]!.split(',');

  // Both reads and the blank labeling columns are present.
  for (const col of ['vlm_crossover', 'fetched_crossover', 'truth_crossover', 'notes']) {
    assert.ok(header.includes(col), `missing column ${col}`);
  }
  // GEV succeeded → 3 indicator rows; BAD is a fake-agent success here too, so
  // both tickers produce 3 rows each = header + 6.
  assert.equal(lines.length, 7, 'header + 2 charts × 3 indicators');

  // The truth_* columns are empty in every data row (user fills them).
  const truthIdx = header.indexOf('truth_crossover');
  for (const row of lines.slice(1)) {
    assert.equal(row.split(',')[truthIdx], '', 'truth column left blank');
  }
});
