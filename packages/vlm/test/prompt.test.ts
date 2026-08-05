import test from 'node:test';
import assert from 'node:assert/strict';

import {
  INDICATOR_PARAMS,
  STOCHASTIC_THRESHOLDS,
  CHART_WINDOW,
} from '@stock-indicator-dailies/shared';

import { buildSystemPrompt, buildUserInstruction } from '../src/prompt.ts';

test('system prompt embeds the shared indicator parameters', () => {
  const p = buildSystemPrompt();
  const { macd, slowStochastic, sma } = INDICATOR_PARAMS;
  assert.match(p, new RegExp(`MACD \\(${macd.fastLength}, ${macd.slowLength}, ${macd.signalSmoothing}\\)`));
  assert.match(p, new RegExp(`%K Length ${slowStochastic.percentKLength}`));
  assert.match(p, new RegExp(`%K Smoothing ${slowStochastic.percentKSmoothing}`));
  assert.match(p, new RegExp(`%D Smoothing ${slowStochastic.percentDSmoothing}`));
  assert.match(p, new RegExp(`period ${sma.period}`));
});

test('system prompt embeds the stochastic thresholds and chart window', () => {
  const p = buildSystemPrompt();
  assert.match(p, new RegExp(`< ${STOCHASTIC_THRESHOLDS.oversold}`));
  assert.match(p, new RegExp(`> ${STOCHASTIC_THRESHOLDS.overbought}`));
  assert.ok(p.includes(CHART_WINDOW.interval));
  assert.ok(p.includes(String(CHART_WINDOW.approximateMonths)));
  assert.ok(p.includes('visibleRange'));
});

test('system prompt names all three indicators and the fact vocabulary', () => {
  const p = buildSystemPrompt();
  for (const key of ['macd', 'slowStochastic', 'sma']) assert.ok(p.includes(key));
  for (const s of ['BULLISH', 'BEARISH', 'NONE']) assert.ok(p.includes(s), `missing ${s}`);
  for (const field of ['crossover', 'barsAgo', 'qualified']) assert.ok(p.includes(field), `missing ${field}`);
  assert.ok(/JSON/.test(p));
});

test('system prompt tells the model to treat whipsaws as NONE', () => {
  const p = buildSystemPrompt();
  assert.match(p, /whipsaw|chopping|noise/i);
});

test('system prompt grounds the read in the on-chart legend numbers', () => {
  const p = buildSystemPrompt();
  // It must tell the model to read the labeled values first...
  assert.match(p, /legend numbers first/i);
  // ...and name the labels it should compare, so %K-vs-%D posture anchors direction.
  for (const label of ['%K', '%D', 'MACD', 'Signal line', 'MA']) {
    assert.ok(p.includes(label), `missing legend label ${label}`);
  }
});

test('system prompt maps blue to the faster line and orange to the signal line', () => {
  const p = buildSystemPrompt();
  assert.match(p, /BLUE line is always the FASTER line/i);
  assert.match(p, /ORANGE line is always the SLOWER signal line/i);
});

test('system prompt forbids anticipating an incomplete cross', () => {
  const p = buildSystemPrompt();
  assert.match(p, /approaching|converging|not yet happened|imminent/i);
});

test('system prompt states the price pane is a close line, not candlesticks', () => {
  const p = buildSystemPrompt();
  assert.match(p, /close line/i);
  assert.match(p, /not candlesticks/i);
});

test('user instruction upper-cases the ticker and cites the window', () => {
  const i = buildUserInstruction('nvda');
  assert.ok(i.includes('NVDA'));
  assert.ok(i.includes(CHART_WINDOW.interval));
});
