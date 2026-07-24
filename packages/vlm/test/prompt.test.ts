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

test('system prompt names all three indicators and the signal vocabulary', () => {
  const p = buildSystemPrompt();
  for (const key of ['macd', 'slowStochastic', 'sma']) assert.ok(p.includes(key));
  for (const s of ['BUY', 'SELL', 'NEUTRAL', 'HOLD']) assert.ok(p.includes(s));
  assert.ok(/JSON/.test(p));
});

test('user instruction upper-cases the ticker and cites the window', () => {
  const i = buildUserInstruction('nvda');
  assert.ok(i.includes('NVDA'));
  assert.ok(i.includes(CHART_WINDOW.interval));
});
