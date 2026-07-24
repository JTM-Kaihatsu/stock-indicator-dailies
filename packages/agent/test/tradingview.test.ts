import test from 'node:test';
import assert from 'node:assert/strict';

import { INDICATOR_PARAMS, CHART_WINDOW } from '@stock-indicator-dailies/shared';

import { TRADINGVIEW, TRADINGVIEW_EXPECTED_STUDIES } from '../src/profiles/tradingview.ts';
import { normalizeLegend, validateStudies } from '../src/studies.ts';
import { extractIntervalToken, isExpectedInterval } from '../src/interval.ts';
import { FakeChartAgent, PLACEHOLDER_PNG_BASE64 } from '../src/fake.ts';
import { ChartAcquisitionError } from '../src/agent.ts';

/** Legend strings captured verbatim from the live "Rule 1" layout. */
const REAL_LEGEND = [
  'SMA10close207.45∅∅∅',
  'MACDclose81790.24541.100.8504',
  'Stoch145370.1369.18',
];

test('chartUrl deep-links the symbol and pins the daily interval', () => {
  assert.equal(
    TRADINGVIEW.chartUrl('nvda'),
    'https://www.tradingview.com/chart/?symbol=NVDA&interval=D',
  );
});

test('chart window token still comes from shared', () => {
  assert.equal(TRADINGVIEW.rangeToken, CHART_WINDOW.label);
});

test('the profile exposes no range-tab selector', () => {
  // date-range-tab-* buttons force an intraday interval ("3 months in 1 hour
  // intervals"), so they must not be reachable from the profile.
  assert.equal('rangeTab' in TRADINGVIEW.selectors, false);
});

test('interval token extraction handles real symbol headers', () => {
  assert.equal(extractIntervalToken(['GGE Vernova Inc.1DNYSE']), '1D');
  assert.equal(extractIntervalToken(['NNVIDIA Corporation1DNASDAQ']), '1D');
  assert.equal(extractIntervalToken(['GGE Vernova Inc.1hNYSE']), '1h');
});

test('interval check catches the hourly-bar regression', () => {
  const daily = ['GGE Vernova Inc.1DNYSE'];
  const hourly = ['GGE Vernova Inc.1hNYSE'];
  assert.equal(isExpectedInterval(daily, TRADINGVIEW.interval.displayToken), true);
  assert.equal(isExpectedInterval(hourly, TRADINGVIEW.interval.displayToken), false);
});

test('interval extraction returns null when no header is present', () => {
  assert.equal(extractIntervalToken(['SMA10close207.45', 'random text']), null);
});

test('capture is scoped to the chart container, not the page', () => {
  assert.equal(TRADINGVIEW.selectors.chartContainer, '.chart-container');
});

test('all three expected studies are declared', () => {
  assert.deepEqual(
    TRADINGVIEW_EXPECTED_STUDIES.map((s) => s.key).sort(),
    ['macd', 'slowStochastic', 'sma'],
  );
});

test('real legend strings satisfy validation', () => {
  const result = validateStudies(REAL_LEGEND, TRADINGVIEW_EXPECTED_STUDIES);
  assert.equal(result.ok, true, `missing: ${result.missing.join(', ')}`);
  assert.equal(result.found.length, 3);
  assert.deepEqual(result.missing, []);
});

test('patterns are built from the shared constants', () => {
  const macd = TRADINGVIEW_EXPECTED_STUDIES.find((s) => s.key === 'macd')!;
  const { fastLength, slowLength, signalSmoothing } = INDICATOR_PARAMS.macd;
  assert.match(`MACDclose${fastLength}${slowLength}${signalSmoothing}0.1`, macd.legendPattern);
});

test('a study with default (wrong) params fails validation', () => {
  // TradingView's stock MACD default is 12/26/9 — must not pass.
  const result = validateStudies(
    ['SMA10close207.45', 'MACDclose122690.24', 'Stoch145370.13'],
    TRADINGVIEW_EXPECTED_STUDIES,
  );
  assert.equal(result.ok, false);
  assert.equal(result.missing.length, 1);
  assert.match(result.missing[0]!, /MACD/);
});

test('a missing study is reported', () => {
  const result = validateStudies(['SMA10close207.45'], TRADINGVIEW_EXPECTED_STUDIES);
  assert.equal(result.ok, false);
  assert.equal(result.missing.length, 2);
});

test('SMA10 does not match a SMA100 study', () => {
  const result = validateStudies(
    ['SMA100close207.45', 'MACDclose81790.24', 'Stoch145370.13'],
    TRADINGVIEW_EXPECTED_STUDIES,
  );
  assert.equal(result.ok, false);
  assert.match(result.missing[0]!, /SMA/);
});

test('normalizeLegend strips whitespace', () => {
  assert.equal(normalizeLegend('  Stoch 14 5 3  70.13 '), 'Stoch145370.13');
});

test('whitespace-separated legends still validate', () => {
  const result = validateStudies(
    ['SMA 10 close 207.45', 'MACD close 8 17 9 0.24', 'Stoch 14 5 3 70.13'],
    TRADINGVIEW_EXPECTED_STUDIES,
  );
  assert.equal(result.ok, true, `missing: ${result.missing.join(', ')}`);
});

test('FakeChartAgent returns an image and records tickers', async () => {
  const agent = new FakeChartAgent();
  const image = await agent.acquire('NVDA');
  assert.equal(image.base64, PLACEHOLDER_PNG_BASE64);
  assert.deepEqual(agent.requested, ['NVDA']);
});

test('FakeChartAgent can simulate a failure mode', async () => {
  const agent = new FakeChartAgent({ failWith: 'not-authenticated' });
  await assert.rejects(
    () => agent.acquire('NVDA'),
    (err: unknown) => err instanceof ChartAcquisitionError && err.reason === 'not-authenticated',
  );
});
