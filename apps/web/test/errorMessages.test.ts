import { test } from 'node:test';
import assert from 'node:assert/strict';

import { dailyFailureMessage, stageLabel } from '../src/lib/errorMessages.ts';

test('stageLabel names the capture stage in plain English', () => {
  assert.match(stageLabel('capture'), /TradingView/);
});

test('stageLabel names the analysis stage in plain English', () => {
  assert.match(stageLabel('analysis'), /Claude/);
});

test('stageLabel falls back to the raw value for an unknown stage', () => {
  assert.equal(stageLabel('some-future-stage'), 'some-future-stage');
});

test('dailyFailureMessage prefers userMessage when present', () => {
  const msg = dailyFailureMessage({ stage: 'analysis', reason: 'provider-unavailable', userMessage: 'Claude is down.' });
  assert.equal(msg, 'Claude is down.');
});

test('dailyFailureMessage falls back to a stage-labeled message without userMessage', () => {
  const msg = dailyFailureMessage({ stage: 'capture', reason: 'popup-blocking' });
  assert.match(msg, /TradingView/);
  assert.match(msg, /popup-blocking/);
});
