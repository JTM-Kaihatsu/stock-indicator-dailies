import test from 'node:test';
import assert from 'node:assert/strict';

import { renderDailyReportHtml } from '../src/report-html.ts';
import type { DailyReport } from '../src/run-daily.ts';

const base: DailyReport = {
  ticker: 'GEV',
  verdict: {
    ticker: 'GEV',
    signal: 'HOLD',
    visibleRange: 'Jan 2026 to Aug 2026',
    readings: [
      { indicator: 'macd', crossover: 'BEARISH', qualified: true, barsAgo: 8, rationale: 'crossed below signal above zero' },
      { indicator: 'slowStochastic', crossover: 'BEARISH', qualified: false, barsAgo: 9 },
      { indicator: 'sma', crossover: 'BEARISH', qualified: true, barsAgo: 4 },
    ],
  },
  deterministic: {
    signal: 'HOLD',
    source: 'yahoo',
    asOf: '2026-07-27',
    bars: 251,
    values: {
      macd: { macd: -15.36, signal: -4.68, histogram: 0.4 },
      stochastic: { percentK: 24.22, percentD: 27.47 },
      sma: 1040.09,
      close: 996.58,
    },
    readings: [
      { indicator: 'macd', crossover: 'BEARISH', qualified: true, barsAgo: 13 },
      { indicator: 'slowStochastic', crossover: 'BEARISH', qualified: false, barsAgo: 3 },
      { indicator: 'sma', crossover: 'BEARISH', qualified: true, barsAgo: 3 },
    ],
  },
  warnings: [],
  timings: { captureMs: 4000, analyzeMs: 5000, deterministicMs: 900, totalMs: 9000, withinTarget: true },
  image: { base64: 'aGVsbG8=', mediaType: 'image/png' },
  raw: '{}',
};

test('renders a self-contained document with both reads', () => {
  const html = renderDailyReportHtml(base);
  assert.match(html, /<!doctype html>/i);
  assert.ok(html.includes('GEV'));
  assert.ok(html.includes('Computed signal'));
  assert.ok(html.includes('AI read'));
  // both signals present
  assert.ok(html.includes('data:image/png;base64,aGVsbG8='));
  // computed numbers appear (hover detail)
  assert.ok(html.includes('-15.36'));
  assert.ok(html.includes('TradingView'));
  assert.ok(html.includes('Not financial advice'));
});

test('flags disagreement when the two signals differ', () => {
  const disagreeing: DailyReport = {
    ...base,
    verdict: { ...base.verdict, signal: 'SELL' },
    deterministic: { ...base.deterministic!, signal: 'HOLD' },
  };
  const html = renderDailyReportHtml(disagreeing);
  assert.match(html, /disagree/i);
});

test('renders without a deterministic read (data fetch failed)', () => {
  const noData: DailyReport = { ...base, deterministic: undefined, warnings: ['deterministic read unavailable'] };
  const html = renderDailyReportHtml(noData);
  assert.ok(html.includes('NO DATA'));
  assert.ok(html.includes('unavailable'));
});

test('escapes user-facing strings', () => {
  const xss: DailyReport = {
    ...base,
    verdict: {
      ...base.verdict,
      readings: [
        { indicator: 'macd', crossover: 'BEARISH', qualified: true, barsAgo: 8, rationale: '<script>alert(1)</script>' },
        base.verdict.readings[1]!,
        base.verdict.readings[2]!,
      ],
    },
  };
  const html = renderDailyReportHtml(xss);
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});
