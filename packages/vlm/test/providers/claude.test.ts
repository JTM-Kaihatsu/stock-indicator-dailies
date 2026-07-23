import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ClaudeVlmProvider,
  DEFAULT_CLAUDE_MODEL,
  type AnthropicLike,
} from '../../src/providers/claude.ts';
import { analyzeChart } from '../../src/analyze.ts';
import type { ChartImage, VlmRequest } from '../../src/provider.ts';

const IMAGE: ChartImage = { base64: 'aGVsbG8=', mediaType: 'image/png' };

const REQUEST: VlmRequest = {
  systemPrompt: 'SYSTEM',
  userInstruction: 'Analyze NVDA',
  image: IMAGE,
};

/** Fake Anthropic client: records the last body, returns canned content. */
function fakeClient(content: Array<{ type: string; text?: string }>): {
  client: AnthropicLike;
  lastBody: () => unknown;
} {
  let body: unknown;
  const client: AnthropicLike = {
    messages: {
      async create(b) {
        body = b;
        return { content };
      },
    },
  };
  return { client, lastBody: () => body };
}

test('maps the request to a Claude vision call', async () => {
  const { client, lastBody } = fakeClient([{ type: 'text', text: '{}' }]);
  const provider = new ClaudeVlmProvider({ client });

  await provider.complete(REQUEST);

  const body = lastBody() as any;
  assert.equal(body.model, DEFAULT_CLAUDE_MODEL);
  assert.equal(body.system, 'SYSTEM');
  assert.equal(body.messages[0].role, 'user');
  const [imageBlock, textBlock] = body.messages[0].content;
  assert.deepEqual(imageBlock, {
    type: 'image',
    source: { type: 'base64', media_type: 'image/png', data: 'aGVsbG8=' },
  });
  assert.deepEqual(textBlock, { type: 'text', text: 'Analyze NVDA' });
  assert.ok(body.max_tokens > 0);
});

test('concatenates text blocks and ignores non-text blocks', async () => {
  const { client } = fakeClient([
    { type: 'thinking', text: undefined },
    { type: 'text', text: '{"a":' },
    { type: 'text', text: '1}' },
  ]);
  const provider = new ClaudeVlmProvider({ client });
  assert.equal(await provider.complete(REQUEST), '{"a":1}');
});

test('model is overridable', async () => {
  const { client, lastBody } = fakeClient([{ type: 'text', text: '{}' }]);
  const provider = new ClaudeVlmProvider({ client, model: 'claude-opus-4-8' });
  await provider.complete(REQUEST);
  assert.equal((lastBody() as any).model, 'claude-opus-4-8');
});

test('plugs into analyzeChart end-to-end', async () => {
  const verdictJson = JSON.stringify({
    ticker: 'NVDA',
    signal: 'SELL',
    readings: [
      { indicator: 'macd', signal: 'SELL' },
      { indicator: 'slowStochastic', signal: 'SELL' },
      { indicator: 'sma', signal: 'NEUTRAL' },
    ],
  });
  const { client } = fakeClient([{ type: 'text', text: '```json\n' + verdictJson + '\n```' }]);
  const provider = new ClaudeVlmProvider({ client });

  const result = await analyzeChart({ ticker: 'nvda', image: IMAGE, provider });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.verdict.ticker, 'NVDA');
  assert.equal(result.verdict.signal, 'SELL'); // two SELL, recomputed authoritatively
});
