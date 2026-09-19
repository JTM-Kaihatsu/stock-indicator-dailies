import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AdvisorUpstreamError,
  AdvisorWallClockTimeoutError,
  checkForMaterialUpdates,
  researchCompany,
  scoreForRiskTolerance,
  type AnthropicLike,
  type GeminiLike,
} from '../src/advisor.ts';
import type { ResearchProposal } from '../src/tool.ts';

const VALID_SETTINGS = {
  buyConsensus: 2, sellConsensus: 3, recencyDays: 3, persistenceBars: 1,
  minHoldingDays: 0, atrPeriod: 14, adxPeriod: 14,
};

function mkResearch(research: string, citations: ResearchProposal['citations'] = []): ResearchProposal {
  return { research, citations };
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
      nextEarningsDate: '2026-10-22',
      earningsOutlook: 'Analysts expect revenue growth of 15% year over year.',
      earningsLikelihood: 'moderate',
      earningsLikelihoodReason: 'The company has beaten expectations 3 of the last 4 quarters.',
      rationaleClaims: [],
      fitReasonClaims: [],
      earningsOutlookClaims: [],
      earningsLikelihoodReasonClaims: [],
      ...overrides,
    },
  };
}

/** Fake Claude client whose responses are scripted call by call. */
function scriptedClaudeClient(responses: Array<{ content: Array<{ type: string; [k: string]: unknown }> }>) {
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

/** Fake Gemini client returning a scripted `text` response, optionally with
 * grounding `candidates` metadata attached. */
function scriptedGeminiClient(text: string | undefined, candidates?: unknown[]) {
  const params: unknown[] = [];
  const client: GeminiLike = {
    models: {
      async generateContent(p) {
        params.push(p);
        return { text, candidates: candidates as never };
      },
    },
  };
  return { client, params };
}

/** Fake `fetch` for citation-URL resolution (see resolveSourceUrl in
 * advisor.ts): `resolutions` maps a requested URL to the `res.url` it
 * should report resolving to (the "real" redirect-resolved URL). A URL
 * mapped to the sentinel `'THROW'` simulates a resolution failure (timeout,
 * blocked HEAD, network error). Also counts calls so tests can assert a
 * distinct URL is only resolved once even if cited by multiple quotes. */
function fakeResolveFetch(resolutions: Record<string, string> = {}): { fetchFn: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const fetchFn = (async (url: string | URL) => {
    const key = String(url);
    calls.push(key);
    if (resolutions[key] === 'THROW') throw new Error('simulated network failure');
    return { url: resolutions[key] ?? key } as Response;
  }) as typeof fetch;
  return { fetchFn, calls };
}

// --- researchCompany: Gemini + Grounding with Google Search ---

test('returns the trimmed text from a successful Gemini call', async () => {
  const { client } = scriptedGeminiClient('  The company operates in a fast-growing, cyclical sector.  ');
  const result = await researchCompany('NVDA', { client });
  assert.equal(result.research, 'The company operates in a fast-growing, cyclical sector.');
});

test('requests the googleSearch grounding tool and names the ticker', async () => {
  const { client, params } = scriptedGeminiClient('Findings.');
  await researchCompany('NVDA', { client });
  const body = params[0] as { contents: string; config: { tools: Array<{ googleSearch?: unknown }> } };
  assert.match(body.contents, /NVDA/);
  assert.ok(body.config.tools.some((t) => 'googleSearch' in t), 'googleSearch tool should be offered');
});

test('throws when Gemini returns no usable text', async () => {
  const { client } = scriptedGeminiClient(undefined);
  await assert.rejects(() => researchCompany('NVDA', { client }), /no usable text/);
});

test('throws when Gemini returns only whitespace', async () => {
  const { client } = scriptedGeminiClient('   ');
  await assert.rejects(() => researchCompany('NVDA', { client }), /no usable text/);
});

test('returns no citations when the response carries no grounding metadata', async () => {
  const { client } = scriptedGeminiClient('Findings with no grounding.');
  const result = await researchCompany('NVDA', { client });
  assert.deepEqual(result.citations, []);
});

test('extracts citations from grounding metadata, with each source URL resolved to its real destination', async () => {
  const candidates = [
    {
      groundingMetadata: {
        groundingChunks: [
          { web: { title: 'Reuters', uri: 'https://redirect/1' } },
          { web: { title: 'Bloomberg', uri: 'https://redirect/2' } },
        ],
        groundingSupports: [
          { segment: { text: 'Google Cloud grew 34% YoY.' }, groundingChunkIndices: [0, 1] },
        ],
      },
    },
  ];
  const { client } = scriptedGeminiClient('Findings.', candidates);
  const { fetchFn } = fakeResolveFetch({
    'https://redirect/1': 'https://reuters.com/tech/google-cloud-q3-2026',
    'https://redirect/2': 'https://bloomberg.com/news/articles/google-cloud-growth',
  });
  const result = await researchCompany('GOOG', { client, resolveFetch: fetchFn });
  assert.deepEqual(result.citations, [
    {
      quote: 'Google Cloud grew 34% YoY.',
      sources: [
        { title: 'Reuters', url: 'https://reuters.com/tech/google-cloud-q3-2026' },
        { title: 'Bloomberg', url: 'https://bloomberg.com/news/articles/google-cloud-growth' },
      ],
    },
  ]);
});

test('falls back to the original redirect URL when resolution fails', async () => {
  const candidates = [
    {
      groundingMetadata: {
        groundingChunks: [{ web: { title: 'Reuters', uri: 'https://redirect/1' } }],
        groundingSupports: [{ segment: { text: 'A claim.' }, groundingChunkIndices: [0] }],
      },
    },
  ];
  const { client } = scriptedGeminiClient('Findings.', candidates);
  const { fetchFn } = fakeResolveFetch({ 'https://redirect/1': 'THROW' });
  const result = await researchCompany('GOOG', { client, resolveFetch: fetchFn });
  assert.equal(result.citations[0]!.sources[0]!.url, 'https://redirect/1');
});

test('resolves a distinct URL only once even when cited by multiple quotes', async () => {
  const candidates = [
    {
      groundingMetadata: {
        groundingChunks: [{ web: { title: 'Reuters', uri: 'https://redirect/1' } }],
        groundingSupports: [
          { segment: { text: 'First claim.' }, groundingChunkIndices: [0] },
          { segment: { text: 'Second claim.' }, groundingChunkIndices: [0] },
        ],
      },
    },
  ];
  const { client } = scriptedGeminiClient('Findings.', candidates);
  const { fetchFn, calls } = fakeResolveFetch({ 'https://redirect/1': 'https://reuters.com/article' });
  const result = await researchCompany('GOOG', { client, resolveFetch: fetchFn });
  assert.deepEqual(calls, ['https://redirect/1']);
  assert.equal(result.citations[0]!.sources[0]!.url, 'https://reuters.com/article');
  assert.equal(result.citations[1]!.sources[0]!.url, 'https://reuters.com/article');
});

test('drops a grounding support with no text or no resolvable sources', async () => {
  const candidates = [
    {
      groundingMetadata: {
        groundingChunks: [{ web: { title: 'Reuters', uri: 'https://redirect/1' } }],
        groundingSupports: [
          { segment: { text: '' }, groundingChunkIndices: [0] },
          { segment: { text: 'Unsourced claim.' }, groundingChunkIndices: [5] },
          { segment: { text: 'Sourced claim.' }, groundingChunkIndices: [0] },
        ],
      },
    },
  ];
  const { client } = scriptedGeminiClient('Findings.', candidates);
  const { fetchFn } = fakeResolveFetch();
  const result = await researchCompany('GOOG', { client, resolveFetch: fetchFn });
  assert.equal(result.citations.length, 1);
  assert.equal(result.citations[0]!.quote, 'Sourced claim.');
});

test('researchCompany translates a 503 overloaded error into a friendly AdvisorUpstreamError', async () => {
  const client: GeminiLike = {
    models: {
      async generateContent() {
        const err = new Error('503 The model is overloaded');
        (err as unknown as { status: number }).status = 503;
        throw err;
      },
    },
  };
  await assert.rejects(
    () => researchCompany('NVDA', { client }),
    (err: unknown) => {
      assert.ok(err instanceof AdvisorUpstreamError);
      assert.equal(err.status, 503);
      assert.match(err.message, /temporarily overloaded/);
      return true;
    },
  );
});

test('researchCompany passes through a non-retryable error unchanged', async () => {
  const client: GeminiLike = {
    models: {
      async generateContent() {
        const err = new Error('401 invalid API key');
        (err as unknown as { status: number }).status = 401;
        throw err;
      },
    },
  };
  await assert.rejects(() => researchCompany('NVDA', { client }), /invalid API key/);
});

test('researchCompany throws AdvisorWallClockTimeoutError when the call runs past timeoutMs', async () => {
  const client: GeminiLike = {
    models: {
      async generateContent() {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return { text: 'Findings.' };
      },
    },
  };
  await assert.rejects(() => researchCompany('NVDA', { client, timeoutMs: 10 }), AdvisorWallClockTimeoutError);
});

// --- checkForMaterialUpdates: the cheap refresh check ---

test('parses a NO response as no updates', async () => {
  const { client } = scriptedGeminiClient('NO');
  const result = await checkForMaterialUpdates('NVDA', '2026-09-01', '2026-09-10', { client });
  assert.equal(result.hasUpdates, false);
  assert.equal(result.summary, null);
});

test('parses a YES response with a summary', async () => {
  const { client } = scriptedGeminiClient('YES\nThe company announced a major new product line.');
  const result = await checkForMaterialUpdates('NVDA', '2026-09-01', '2026-09-10', { client });
  assert.equal(result.hasUpdates, true);
  assert.equal(result.summary, 'The company announced a major new product line.');
});

test('treats an empty or malformed response as no updates', async () => {
  const { client } = scriptedGeminiClient(undefined);
  const result = await checkForMaterialUpdates('NVDA', '2026-09-01', '2026-09-10', { client });
  assert.equal(result.hasUpdates, false);
  assert.equal(result.summary, null);
});

test('checkForMaterialUpdates passes the ticker, since-date, and today into the prompt', async () => {
  const { client, params } = scriptedGeminiClient('NO');
  await checkForMaterialUpdates('AAPL', '2026-08-15', '2026-09-10', { client });
  const body = params[0] as { contents: string };
  assert.match(body.contents, /AAPL/);
  assert.match(body.contents, /2026-08-15/);
  assert.match(body.contents, /2026-09-10/);
});

// --- scoreForRiskTolerance: a single forced Claude call, no search loop ---

test('returns the validated proposal from a single forced call', async () => {
  const { client, bodies } = scriptedClaudeClient([{ content: [proposeSettingsBlock()] }]);
  const result = await scoreForRiskTolerance('NVDA', mkResearch('Some research findings.'), 'averse', { client });
  assert.equal(result.rationale, 'Because the sector is trending.');
  assert.deepEqual(result.settings, VALID_SETTINGS);
  assert.equal(result.fit, 'within-bounds');
  assert.equal(result.nextEarningsDate, '2026-10-22');
  assert.equal(result.earningsOutlook, 'Analysts expect revenue growth of 15% year over year.');
  assert.equal(result.earningsLikelihood, 'moderate');
  assert.equal(bodies.length, 1, 'no search loop; exactly one call');
  const body = bodies[0] as { tools: Array<{ name: string }>; tool_choice: { type: string; name?: string } };
  assert.ok(!body.tools.some((t) => t.name === 'web_search'), 'no web_search tool offered in the scoring step');
  assert.deepEqual(body.tool_choice, { type: 'tool', name: 'propose_settings' });
});

test('passes the ticker, research, citations, and risk tolerance label into the user message', async () => {
  const { client, bodies } = scriptedClaudeClient([{ content: [proposeSettingsBlock()] }]);
  const research = mkResearch('Findings about Apple.', [
    { quote: 'Apple beat EPS estimates.', sources: [{ title: 'Reuters', url: 'https://x' }] },
  ]);
  await scoreForRiskTolerance('AAPL', research, 'seeking', { client });
  const body = bodies[0] as { messages: Array<{ content: string }> };
  const userContent = body.messages[0]!.content;
  assert.match(userContent, /AAPL/);
  assert.match(userContent, /Findings about Apple\./);
  assert.match(userContent, /risk-seeking/);
  assert.match(userContent, /\[0\] "Apple beat EPS estimates\." \(sources: Reuters\)/);
});

test('resolves claims and citation indices into fieldCitations', async () => {
  const research = mkResearch('Findings.', [
    { quote: 'Quote A.', sources: [{ title: 'Reuters', url: 'https://a' }] },
    { quote: 'Quote B.', sources: [{ title: 'Bloomberg', url: 'https://b' }] },
  ]);
  const { client } = scriptedClaudeClient([
    {
      content: [
        proposeSettingsBlock({
          rationaleClaims: [{ claim: 'Claim A.', citationIndices: [0] }],
          fitReasonClaims: [{ claim: 'Claim B.', citationIndices: [1] }],
          earningsOutlookClaims: [{ claim: 'Claim C.', citationIndices: [0, 1] }],
        }),
      ],
    },
  ]);
  const result = await scoreForRiskTolerance('NVDA', research, 'neutral', { client });
  assert.deepEqual(result.fieldCitations.rationale, [{ claim: 'Claim A.', quotes: [research.citations[0]] }]);
  assert.deepEqual(result.fieldCitations.fitReason, [{ claim: 'Claim B.', quotes: [research.citations[1]] }]);
  assert.deepEqual(result.fieldCitations.earningsOutlook, [{ claim: 'Claim C.', quotes: research.citations }]);
  assert.deepEqual(result.fieldCitations.earningsLikelihoodReason, []);
});

test('drops out-of-range or malformed citation indices within a claim rather than throwing', async () => {
  const research = mkResearch('Findings.', [
    { quote: 'Quote A.', sources: [{ title: 'Reuters', url: 'https://a' }] },
  ]);
  const { client } = scriptedClaudeClient([
    { content: [proposeSettingsBlock({ rationaleClaims: [{ claim: 'Claim A.', citationIndices: [0, 5, -1, 'x'] }] })] },
  ]);
  const result = await scoreForRiskTolerance('NVDA', research, 'neutral', { client });
  assert.deepEqual(result.fieldCitations.rationale, [{ claim: 'Claim A.', quotes: [research.citations[0]] }]);
});

test('keeps a claim with zero resolvable quotes rather than dropping it', async () => {
  const research = mkResearch('Findings.', [
    { quote: 'Quote A.', sources: [{ title: 'Reuters', url: 'https://a' }] },
  ]);
  const { client } = scriptedClaudeClient([
    { content: [proposeSettingsBlock({ rationaleClaims: [{ claim: 'Pure synthesis, nothing directly citable.', citationIndices: [] }] })] },
  ]);
  const result = await scoreForRiskTolerance('NVDA', research, 'neutral', { client });
  assert.deepEqual(result.fieldCitations.rationale, [{ claim: 'Pure synthesis, nothing directly citable.', quotes: [] }]);
});

test('drops a malformed claim entry (missing/non-string claim) rather than throwing', async () => {
  const research = mkResearch('Findings.', []);
  const { client } = scriptedClaudeClient([
    { content: [proposeSettingsBlock({ rationaleClaims: [{ citationIndices: [] }, { claim: '', citationIndices: [] }] })] },
  ]);
  const result = await scoreForRiskTolerance('NVDA', research, 'neutral', { client });
  assert.deepEqual(result.fieldCitations.rationale, []);
});

test('rejects a proposal with an out-of-range field', async () => {
  const { client } = scriptedClaudeClient([{ content: [proposeSettingsBlock({ settings: { ...VALID_SETTINGS, buyConsensus: 99 } })] }]);
  await assert.rejects(() => scoreForRiskTolerance('NVDA', mkResearch('research'), 'neutral', { client }), /outside the allowed range/);
});

test('rejects a proposal with an invalid fit value', async () => {
  const { client } = scriptedClaudeClient([{ content: [proposeSettingsBlock({ fit: 'sure-why-not' })] }]);
  await assert.rejects(() => scoreForRiskTolerance('NVDA', mkResearch('research'), 'neutral', { client }), /must be one of/);
});

test('rejects a proposal missing fitReason', async () => {
  const { client } = scriptedClaudeClient([{ content: [proposeSettingsBlock({ fitReason: '' })] }]);
  await assert.rejects(() => scoreForRiskTolerance('NVDA', mkResearch('research'), 'neutral', { client }), /fitReason/);
});

test('rejects a proposal with an invalid earningsLikelihood value', async () => {
  const { client } = scriptedClaudeClient([{ content: [proposeSettingsBlock({ earningsLikelihood: 'super-high' })] }]);
  await assert.rejects(() => scoreForRiskTolerance('NVDA', mkResearch('research'), 'neutral', { client }), /earningsLikelihood/);
});

test('rejects a proposal missing earningsOutlook', async () => {
  const { client } = scriptedClaudeClient([{ content: [proposeSettingsBlock({ earningsOutlook: '' })] }]);
  await assert.rejects(() => scoreForRiskTolerance('NVDA', mkResearch('research'), 'neutral', { client }), /earningsOutlook/);
});

test('accepts and normalizes a null nextEarningsDate', async () => {
  const { client } = scriptedClaudeClient([{ content: [proposeSettingsBlock({ nextEarningsDate: null })] }]);
  const result = await scoreForRiskTolerance('NVDA', mkResearch('research'), 'neutral', { client });
  assert.equal(result.nextEarningsDate, null);
});

test('strips stray trailing pseudo-XML scaffolding from rationale, fitReason, and earnings fields', async () => {
  const { client } = scriptedClaudeClient([
    { content: [proposeSettingsBlock({
      rationale: 'Because the sector is trending.</rationale>\n',
      fitReason: 'A real reason.</fitReason>\n</invoke>\n',
      earningsOutlook: 'Analysts expect growth.</earningsOutlook>\n',
      earningsLikelihoodReason: 'Beat history supports this.</earningsLikelihoodReason>\n</invoke>\n',
    })] },
  ]);
  const result = await scoreForRiskTolerance('NVDA', mkResearch('research'), 'neutral', { client });
  assert.equal(result.rationale, 'Because the sector is trending.');
  assert.equal(result.fitReason, 'A real reason.');
  assert.equal(result.earningsOutlook, 'Analysts expect growth.');
  assert.equal(result.earningsLikelihoodReason, 'Beat history supports this.');
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
    () => scoreForRiskTolerance('NVDA', mkResearch('research'), 'neutral', { client }),
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
    () => scoreForRiskTolerance('NVDA', mkResearch('research'), 'neutral', { client, timeoutMs: 10 }),
    AdvisorWallClockTimeoutError,
  );
});
