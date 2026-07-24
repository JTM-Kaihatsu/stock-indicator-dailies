import test from 'node:test';
import assert from 'node:assert/strict';

import { INDICATOR_PARAMS, CHART_WINDOW } from '@stock-indicator-dailies/shared';

import { TRADINGVIEW } from '../src/profiles/tradingview.ts';
import { FakeChartAgent, PLACEHOLDER_PNG_BASE64 } from '../src/fake.ts';
import { ChartAcquisitionError } from '../src/agent.ts';

test('chartUrl deep-links the upper-cased symbol', () => {
  assert.equal(
    TRADINGVIEW.chartUrl('nvda'),
    'https://www.tradingview.com/chart/?symbol=NVDA',
  );
});

test('range token comes from the shared chart window', () => {
  assert.equal(TRADINGVIEW.rangeToken, CHART_WINDOW.label);
});

test('indicator params are wired to the shared constants', () => {
  const byName = Object.fromEntries(TRADINGVIEW.indicators.map((i) => [i.searchName, i.params]));

  assert.equal(byName['MACD']!['Fast Length'], INDICATOR_PARAMS.macd.fastLength);
  assert.equal(byName['MACD']!['Slow Length'], INDICATOR_PARAMS.macd.slowLength);
  assert.equal(byName['MACD']!['Signal Smoothing'], INDICATOR_PARAMS.macd.signalSmoothing);
  assert.equal(byName['Stochastic']!['%K Length'], INDICATOR_PARAMS.slowStochastic.percentK);
  assert.equal(byName['Stochastic']!['%D Smoothing'], INDICATOR_PARAMS.slowStochastic.percentD);
  assert.equal(byName['Moving Average Simple']!['Length'], INDICATOR_PARAMS.sma.period);
});

test('all three indicators are covered', () => {
  assert.equal(TRADINGVIEW.indicators.length, 3);
});

test('FakeChartAgent returns an image and records tickers', async () => {
  const agent = new FakeChartAgent();
  const image = await agent.acquire('NVDA');
  assert.equal(image.base64, PLACEHOLDER_PNG_BASE64);
  assert.equal(image.mediaType, 'image/png');
  assert.deepEqual(agent.requested, ['NVDA']);
});

test('FakeChartAgent can simulate a failure mode', async () => {
  const agent = new FakeChartAgent({ failWith: 'not-authenticated' });
  await assert.rejects(
    () => agent.acquire('NVDA'),
    (err: unknown) => err instanceof ChartAcquisitionError && err.reason === 'not-authenticated',
  );
});
