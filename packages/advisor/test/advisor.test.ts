import test from 'node:test';
import assert from 'node:assert/strict';

import { AdvisorTimeoutError, researchAndPropose, type AnthropicLike } from '../src/advisor.ts';

const VALID_SETTINGS = {
  buyConsensus: 2, sellConsensus: 3, recencyDays: 3, persistenceBars: 1,
  minHoldingDays: 0, atrPeriod: 14, adxPeriod: 14,
};

function proposeSettingsBlock(overrides: Record<string, unknown> = {}) {
  return {
    type: 'tool_use',
    id: 'tu_1',
    name: 'propose_settings',
    input: { rationale: 'Because the sector is trending.', settings: { ...VALID_SETTINGS, ...overrides } },
  };
}

/** Fake client whose responses are scripted turn by turn. */
function scriptedClient(responses: Array<{ content: Array<{ type: string; [k: string]: unknown }> }>) {
  let call = 0;
  const bodies: unknown[] = [];
  const client: AnthropicLike = {
    messages: {
      async create(body) {
        bodies.push(body);
        const response = responses[call] ?? responses[responses.length - 1]!;
        call++;
        return response;
      },
    },
  };
  return { client, bodies };
}

test('returns the proposal immediately when the model calls propose_settings on the first turn', async () => {
  const { client } = scriptedClient([{ content: [proposeSettingsBlock()] }]);
  const result = await researchAndPropose('NVDA', { client, maxTurns: 4 });
  assert.equal(result.rationale, 'Because the sector is trending.');
  assert.deepEqual(result.settings, VALID_SETTINGS);
});

test('continues past a search-only turn and returns once propose_settings is called', async () => {
  const { client, bodies } = scriptedClient([
    { content: [
      { type: 'server_tool_use', id: 'st_1', name: 'web_search', input: { query: 'NVDA competitors' } },
      { type: 'web_search_tool_result', tool_use_id: 'st_1', content: [] },
      { type: 'text', text: 'Let me look into recent trends too.' },
    ] },
    { content: [proposeSettingsBlock({ buyConsensus: 3 })] },
  ]);
  const result = await researchAndPropose('NVDA', { client, maxTurns: 4 });
  assert.equal(result.settings.buyConsensus, 3);
  assert.equal(bodies.length, 2, 'should have made exactly 2 calls');
});

test('forces tool_choice to propose_settings on the final allowed turn', async () => {
  const { client, bodies } = scriptedClient([
    { content: [{ type: 'text', text: 'still searching' }] },
    { content: [{ type: 'text', text: 'still searching' }] },
    { content: [proposeSettingsBlock()] },
  ]);
  await researchAndPropose('NVDA', { client, maxTurns: 3 });
  const lastBody = bodies[bodies.length - 1] as { tool_choice: { type: string; name?: string } };
  assert.deepEqual(lastBody.tool_choice, { type: 'tool', name: 'propose_settings' });
});

test('throws AdvisorTimeoutError if propose_settings is never called', async () => {
  const { client } = scriptedClient([{ content: [{ type: 'text', text: 'thinking...' }] }]);
  await assert.rejects(() => researchAndPropose('NVDA', { client, maxTurns: 2 }), AdvisorTimeoutError);
});

test('rejects a proposal with an out-of-range field', async () => {
  const { client } = scriptedClient([{ content: [proposeSettingsBlock({ buyConsensus: 99 })] }]);
  await assert.rejects(() => researchAndPropose('NVDA', { client, maxTurns: 1 }), /outside the allowed range/);
});

test('rejects a proposal missing a rationale', async () => {
  const { client } = scriptedClient([
    { content: [{ type: 'tool_use', id: 'tu_1', name: 'propose_settings', input: { settings: VALID_SETTINGS } }] },
  ]);
  await assert.rejects(() => researchAndPropose('NVDA', { client, maxTurns: 1 }), /rationale/);
});
