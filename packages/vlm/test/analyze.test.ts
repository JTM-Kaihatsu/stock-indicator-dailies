import test from 'node:test';
import assert from 'node:assert/strict';

import { analyzeChart, interpretChartResponse } from '../src/analyze.ts';
import type { ChartImage, VlmProvider, VlmRequest } from '../src/provider.ts';

const IMAGE: ChartImage = { base64: 'aGVsbG8=', mediaType: 'image/png' };

/** A provider that returns a canned response and records the request it got. */
class FakeProvider implements VlmProvider {
  readonly name = 'fake';
  lastRequest: VlmRequest | undefined;
  readonly #response: string;
  constructor(response: string) {
    this.#response = response;
  }
  async complete(request: VlmRequest): Promise<string> {
    this.lastRequest = request;
    return this.#response;
  }
}

const goodJson = JSON.stringify({
  ticker: 'NVDA',
  signal: 'HOLD',
  readings: [
    { indicator: 'macd', signal: 'BUY' },
    { indicator: 'slowStochastic', signal: 'NEUTRAL' },
    { indicator: 'sma', signal: 'NEUTRAL' },
  ],
});

test('analyzeChart builds the request and returns a validated verdict', async () => {
  const provider = new FakeProvider(goodJson);
  const result = await analyzeChart({ ticker: 'nvda', image: IMAGE, provider });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.verdict.ticker, 'NVDA');
  assert.equal(result.verdict.signal, 'HOLD');
  assert.equal(result.raw, goodJson);

  // The provider received the assembled prompt + image.
  assert.ok(provider.lastRequest);
  assert.ok(provider.lastRequest!.systemPrompt.includes('MACD'));
  assert.ok(provider.lastRequest!.userInstruction.includes('NVDA'));
  assert.equal(provider.lastRequest!.image, IMAGE);
});

test('requested ticker is authoritative over whatever the model returns', () => {
  const raw = JSON.stringify({
    ticker: 'WRONG',
    readings: [
      { indicator: 'macd', signal: 'NEUTRAL' },
      { indicator: 'slowStochastic', signal: 'NEUTRAL' },
      { indicator: 'sma', signal: 'NEUTRAL' },
    ],
  });
  const result = interpretChartResponse(raw, { ticker: 'tsla' });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.verdict.ticker, 'TSLA');
});

test('fenced JSON from the model is handled', () => {
  const raw = '```json\n' + goodJson + '\n```';
  const result = interpretChartResponse(raw, { ticker: 'NVDA' });
  assert.equal(result.ok, true);
});

test('model output with no JSON is a clean error, raw preserved', () => {
  const raw = 'I was unable to read the indicators on this chart.';
  const result = interpretChartResponse(raw, { ticker: 'NVDA' });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.errors.join('\n'), /no JSON object found/);
  assert.equal(result.raw, raw);
});

test('derived signal overrides a disagreeing model signal, with a warning', () => {
  const raw = JSON.stringify({
    signal: 'HOLD',
    readings: [
      { indicator: 'macd', signal: 'SELL' },
      { indicator: 'slowStochastic', signal: 'SELL' },
      { indicator: 'sma', signal: 'BUY' },
    ],
  });
  const result = interpretChartResponse(raw, { ticker: 'NVDA' });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.verdict.signal, 'SELL'); // two SELL wins
  assert.match(result.warnings.join('\n'), /disagreed/);
});

test('parse options flow through interpretChartResponse', () => {
  const raw = JSON.stringify({
    readings: [
      { indicator: 'macd', signal: 'BUY' },
      { indicator: 'slowStochastic', signal: 'BUY' },
      { indicator: 'sma', signal: 'NEUTRAL' },
    ],
  });
  const strict = interpretChartResponse(raw, { ticker: 'NVDA' });
  assert.equal(strict.ok && strict.verdict.signal, 'HOLD'); // default buyConsensus 3

  const loose = interpretChartResponse(raw, { ticker: 'NVDA' }, { buyConsensus: 2 });
  assert.equal(loose.ok && loose.verdict.signal, 'BUY');
});
