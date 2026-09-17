import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AdvisorTimeoutError,
  AdvisorUpstreamError,
  AdvisorWallClockTimeoutError,
  researchCompany,
  scoreForRiskTolerance,
  type AnthropicLike,
} from '../src/advisor.ts';

const VALID_SETTINGS = {
  buyConsensus: 2, sellConsensus: 3, recencyDays: 3, persistenceBars: 1,
  minHoldingDays: 0, atrPeriod: 14, adxPeriod: 14,
};

function submitResearchBlock(overrides: Record<string, unknown> = {}) {
  return {
    type: 'tool_use',
    id: 'tu_1',
    name: 'submit_research',
    input: { research: 'The company operates in a fast-growing, cyclical sector.', ...overrides },
  };
}

function proposeSettingsBlock(overrides: Record<string, unknown> = {}) {
  return {
    type: 'tool_use',
    id: 'tu_2',
    name: 'propose_settings',
    input: {
      rationale: 'Because the sector is trending.',
      settings: VALID_SETTINGS,
      fit: 'within-bounds',
      fitReason: 'Nothing in the research suggests unusual risk.',
      ...overrides,
    },
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

// --- researchCompany: the web-search loop (mirrors the old researchAndPropose's mechanics) ---

test('returns the research immediately when the model calls submit_research on the first turn', async () => {
  const { client } = scriptedClient([{ content: [submitResearchBlock()] }]);
  const result = await researchCompany('NVDA', { client, maxTurns: 4 });
  assert.equal(result.research, 'The company operates in a fast-growing, cyclical sector.');
});

test('continues past a search-only turn and returns once submit_research is called', async () => {
  const { client, bodies } = scriptedClient([
    { content: [
      { type: 'server_tool_use', id: 'st_1', name: 'web_search', input: { query: 'NVDA competitors' } },
      { type: 'web_search_tool_result', tool_use_id: 'st_1', content: [] },
      { type: 'text', text: 'Let me look into recent trends too.' },
    ] },
    { content: [submitResearchBlock({ research: 'Updated findings after more research.' })] },
  ]);
  const result = await researchCompany('NVDA', { client, maxTurns: 4 });
  assert.equal(result.research, 'Updated findings after more research.');
  assert.equal(bodies.length, 2, 'should have made exactly 2 calls');
});

test('forces tool_choice to submit_research on the final allowed turn', async () => {
  const { client, bodies } = scriptedClient([
    { content: [{ type: 'text', text: 'still searching' }] },
    { content: [{ type: 'text', text: 'still searching' }] },
    { content: [submitResearchBlock()] },
  ]);
  await researchCompany('NVDA', { client, maxTurns: 3 });
  const lastBody = bodies[bodies.length - 1] as { tool_choice: { type: string; name?: string } };
  assert.deepEqual(lastBody.tool_choice, { type: 'tool', name: 'submit_research' });
});

test('throws AdvisorTimeoutError if submit_research is never called', async () => {
  const { client } = scriptedClient([{ content: [{ type: 'text', text: 'thinking...' }] }]);
  await assert.rejects(() => researchCompany('NVDA', { client, maxTurns: 2 }), AdvisorTimeoutError);
});

test('rejects a submission missing non-empty research', async () => {
  const { client } = scriptedClient([
    { content: [{ type: 'tool_use', id: 'tu_1', name: 'submit_research', input: { research: '' } }] },
  ]);
  await assert.rejects(() => researchCompany('NVDA', { client, maxTurns: 1 }), /non-empty research/);
});

test('strips stray trailing pseudo-XML scaffolding a live capture showed the model can leak into a field', async () => {
  const { client } = scriptedClient([
    { content: [submitResearchBlock({ research: 'Real findings here.</research>\n</invoke>\n' })] },
  ]);
  const result = await researchCompany('NVDA', { client, maxTurns: 1 });
  assert.equal(result.research, 'Real findings here.');
});

test('a submission that is only trailing artifacts, with no real content, is rejected as empty', async () => {
  const { client } = scriptedClient([{ content: [submitResearchBlock({ research: '</research>\n</invoke>' })] }]);
  await assert.rejects(() => researchCompany('NVDA', { client, maxTurns: 1 }), /non-empty research/);
});

test('shrinks max_uses across turns based on the cumulative search budget', async () => {
  const { client, bodies } = scriptedClient([
    { content: [
      { type: 'server_tool_use', id: 'st_1', name: 'web_search', input: { query: 'a' } },
      { type: 'server_tool_use', id: 'st_2', name: 'web_search', input: { query: 'b' } },
      { type: 'server_tool_use', id: 'st_3', name: 'web_search', input: { query: 'c' } },
    ] },
    { content: [submitResearchBlock()] },
  ]);
  await researchCompany('NVDA', { client, maxTurns: 4, searchBudget: 5 });
  const firstTools = (bodies[0] as { tools: Array<{ name: string; max_uses?: number }> }).tools;
  assert.equal(firstTools.find((t) => t.name === 'web_search')?.max_uses, 5);
  const secondTools = (bodies[1] as { tools: Array<{ name: string; max_uses?: number }> }).tools;
  assert.equal(secondTools.find((t) => t.name === 'web_search')?.max_uses, 2);
});

test('drops web_search and forces submit_research once the search budget is exhausted', async () => {
  const { client, bodies } = scriptedClient([
    { content: [
      { type: 'server_tool_use', id: 'st_1', name: 'web_search', input: { query: 'a' } },
      { type: 'server_tool_use', id: 'st_2', name: 'web_search', input: { query: 'b' } },
    ] },
    { content: [submitResearchBlock()] },
  ]);
  await researchCompany('NVDA', { client, maxTurns: 4, searchBudget: 2 });
  assert.equal(bodies.length, 2, 'should stop after budget exhausted, not wait for maxTurns');
  const secondBody = bodies[1] as { tools: Array<{ name: string }>; tool_choice: { type: string; name?: string } };
  assert.ok(!secondBody.tools.some((t) => t.name === 'web_search'), 'web_search should be dropped once budget is exhausted');
  assert.deepEqual(secondBody.tool_choice, { type: 'tool', name: 'submit_research' });
});

test('researchCompany translates a 529 overloaded error into a friendly AdvisorUpstreamError', async () => {
  const client: AnthropicLike = {
    messages: {
      async create() {
        const err = new Error('529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}');
        (err as unknown as { status: number }).status = 529;
        throw err;
      },
    },
  };
  await assert.rejects(
    () => researchCompany('NVDA', { client, maxTurns: 1 }),
    (err: unknown) => {
      assert.ok(err instanceof AdvisorUpstreamError);
      assert.equal(err.status, 529);
      assert.match(err.message, /temporarily overloaded/);
      return true;
    },
  );
});

test('researchCompany passes through a non-retryable error unchanged', async () => {
  const client: AnthropicLike = {
    messages: {
      async create() {
        const err = new Error('401 invalid API key');
        (err as unknown as { status: number }).status = 401;
        throw err;
      },
    },
  };
  await assert.rejects(() => researchCompany('NVDA', { client, maxTurns: 1 }), /invalid API key/);
});

test('researchCompany throws AdvisorWallClockTimeoutError when the call runs past timeoutMs', async () => {
  const client: AnthropicLike = {
    messages: {
      async create() {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return { content: [submitResearchBlock()] };
      },
    },
  };
  await assert.rejects(
    () => researchCompany('NVDA', { client, maxTurns: 1, timeoutMs: 10 }),
    AdvisorWallClockTimeoutError,
  );
});

// --- scoreForRiskTolerance: a single forced call, no search loop ---

test('returns the validated proposal from a single forced call', async () => {
  const { client, bodies } = scriptedClient([{ content: [proposeSettingsBlock()] }]);
  const result = await scoreForRiskTolerance('NVDA', 'Some research findings.', 'averse', { client });
  assert.equal(result.rationale, 'Because the sector is trending.');
  assert.deepEqual(result.settings, VALID_SETTINGS);
  assert.equal(result.fit, 'within-bounds');
  assert.equal(bodies.length, 1, 'no search loop; exactly one call');
  const body = bodies[0] as { tools: Array<{ name: string }>; tool_choice: { type: string; name?: string } };
  assert.ok(!body.tools.some((t) => t.name === 'web_search'), 'no web_search tool offered in the scoring step');
  assert.deepEqual(body.tool_choice, { type: 'tool', name: 'propose_settings' });
});

test('passes the ticker, research, and risk tolerance label into the user message', async () => {
  const { client, bodies } = scriptedClient([{ content: [proposeSettingsBlock()] }]);
  await scoreForRiskTolerance('AAPL', 'Findings about Apple.', 'seeking', { client });
  const body = bodies[0] as { messages: Array<{ content: string }> };
  const userContent = body.messages[0]!.content;
  assert.match(userContent, /AAPL/);
  assert.match(userContent, /Findings about Apple\./);
  assert.match(userContent, /risk-seeking/);
});

test('rejects a proposal with an out-of-range field', async () => {
  const { client } = scriptedClient([{ content: [proposeSettingsBlock({ settings: { ...VALID_SETTINGS, buyConsensus: 99 } })] }]);
  await assert.rejects(() => scoreForRiskTolerance('NVDA', 'research', 'neutral', { client }), /outside the allowed range/);
});

test('rejects a proposal with an invalid fit value', async () => {
  const { client } = scriptedClient([{ content: [proposeSettingsBlock({ fit: 'sure-why-not' })] }]);
  await assert.rejects(() => scoreForRiskTolerance('NVDA', 'research', 'neutral', { client }), /must be one of/);
});

test('rejects a proposal missing fitReason', async () => {
  const { client } = scriptedClient([{ content: [proposeSettingsBlock({ fitReason: '' })] }]);
  await assert.rejects(() => scoreForRiskTolerance('NVDA', 'research', 'neutral', { client }), /fitReason/);
});

test('strips stray trailing pseudo-XML scaffolding from rationale and fitReason', async () => {
  const { client } = scriptedClient([
    { content: [proposeSettingsBlock({
      rationale: 'Because the sector is trending.</rationale>\n',
      fitReason: 'A real reason.</fitReason>\n</invoke>\n',
    })] },
  ]);
  const result = await scoreForRiskTolerance('NVDA', 'research', 'neutral', { client });
  assert.equal(result.rationale, 'Because the sector is trending.');
  assert.equal(result.fitReason, 'A real reason.');
});

test('scoreForRiskTolerance translates a 529 overloaded error into a friendly AdvisorUpstreamError', async () => {
  const client: AnthropicLike = {
    messages: {
      async create() {
        const err = new Error('529 overloaded');
        (err as unknown as { status: number }).status = 529;
        throw err;
      },
    },
  };
  await assert.rejects(
    () => scoreForRiskTolerance('NVDA', 'research', 'neutral', { client }),
    (err: unknown) => {
      assert.ok(err instanceof AdvisorUpstreamError);
      assert.equal(err.status, 529);
      return true;
    },
  );
});

test('scoreForRiskTolerance throws AdvisorWallClockTimeoutError when the call runs past timeoutMs', async () => {
  const client: AnthropicLike = {
    messages: {
      async create() {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return { content: [proposeSettingsBlock()] };
      },
    },
  };
  await assert.rejects(
    () => scoreForRiskTolerance('NVDA', 'research', 'neutral', { client, timeoutMs: 10 }),
    AdvisorWallClockTimeoutError,
  );
});
