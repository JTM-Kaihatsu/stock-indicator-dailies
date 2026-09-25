/** This package's `test` script runs with node:test's --test-force-exit:
 * the scoreForRiskTolerance loop tests below make several sequential
 * client.messages.create() calls per test, and node:test's own reporter
 * leaves dangling handles that keep the process alive well past every
 * test completing (verified: all tests here pass in ~1s; without
 * --test-force-exit the process simply never exits on its own). Confirmed
 * this isn't a leak in scoreForRiskTolerance itself: a standalone script
 * calling it directly, outside node:test, exits cleanly with zero active
 * handles. */
import test from 'node:test';
import assert from 'node:assert/strict';

import type { Bar } from '@stock-indicator-dailies/indicators';

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

/** Enough bars (with real daily-range spread) for runBacktest's own
 * computeReadings/ATR/ADX warmup to run without throwing; scoreForRiskTolerance
 * runs a reference backtest before ever calling Claude, so every test using
 * it needs a bars fixture regardless of whether that test cares about the
 * backtest's actual numbers. A mild uptrend, not hand-tuned to produce any
 * particular signal; tests that care about specific backtest output use
 * runBacktestBlock's own scripted result instead of relying on what this
 * fixture would really produce. */
function syntheticBars(n = 60): Bar[] {
  return Array.from({ length: n }, (_, i) => {
    const close = 100 + i * 0.5;
    const date = new Date(2024, 0, 1 + i).toISOString().slice(0, 10);
    return { date, open: close - 0.2, high: close + 1, low: close - 1, close };
  });
}

/** Unlike syntheticBars' smooth monotonic drift (which the 3-indicator vote
 * system rarely crosses on at all, so most settings combos there produce 0
 * trades), this oscillates around an uptrend so real crossovers actually
 * fire; the substituteBetterCandidate tests below need settings combos that
 * organically differ in real backtested performance, not just scripted
 * BacktestSummary text. */
function oscillatingBars(n = 120): Bar[] {
  return Array.from({ length: n }, (_, i) => {
    const close = 100 + i * 0.6 + 12 * Math.sin(i / 6);
    const date = new Date(2023, 0, 1 + i).toISOString().slice(0, 10);
    return { date, open: close - 0.3, high: close + 1.5, low: close - 1.5, close };
  });
}

/** Same oscillation as oscillatingBars, but trending down overall, so a
 * strategy that stays long through the whole window loses money while more
 * selective settings can still catch some of the interim swings. */
function downtrendBars(n = 120): Bar[] {
  return Array.from({ length: n }, (_, i) => {
    const close = 160 - i * 0.6 + 12 * Math.sin(i / 6);
    const date = new Date(2023, 0, 1 + i).toISOString().slice(0, 10);
    return { date, open: close - 0.3, high: close + 1.5, low: close - 1.5, close };
  });
}

function mkResearch(research: string, citations: ResearchProposal['citations'] = []): ResearchProposal {
  return { research, citations };
}

/** scoreForRiskTolerance now runs its result's nextEarningsDate through
 * validateEarningsDate, which checks staleness against the real wall
 * clock (see advisor.ts; there's no injectable "now" for this, unlike
 * checkForMaterialUpdates's context.now). A fixture hardcoded to a
 * specific calendar date would silently start failing (or start making
 * real network calls to a fake client) the moment real time passed it;
 * computed a year out from whenever the suite actually runs instead, so
 * it's always safely in the future regardless of when that is. */
const FUTURE_EARNINGS_DATE = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

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
      nextEarningsDate: FUTURE_EARNINGS_DATE,
      nextEarningsDateSource: 'investor.example.com',
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

/** A scripted run_backtest tool call, for the turn(s) that must happen
 * before scoreForRiskTolerance will ever honor propose_settings. */
function runBacktestBlock(overrides: Record<string, unknown> = {}, id = 'tu_1') {
  return {
    type: 'tool_use',
    id,
    name: 'run_backtest',
    input: { ...VALID_SETTINGS, ...overrides },
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

/** Like scriptedGeminiClient, but a different response per call (falling
 * back to the last one after that), for tests exercising the earnings-date
 * validation's domain-excluded second search: the first call is the main
 * check/research response, the second is searchEarningsDateExcludingDomain's
 * own follow-up. */
function scriptedGeminiClientSequence(responses: Array<{ text?: string; candidates?: unknown[] }>) {
  let call = 0;
  const params: unknown[] = [];
  const client: GeminiLike = {
    models: {
      async generateContent(p) {
        params.push(p);
        const response = responses[call] ?? responses[responses.length - 1]!;
        call++;
        return { text: response.text, candidates: response.candidates as never };
      },
    },
  };
  return { client, params };
}

/** Fake `fetch` for citation-URL resolution (see resolveSourceUrl in
 * advisor.ts): `resolutions` maps a requested URL to the `res.url` it
 * should report resolving to (the "real" redirect-resolved URL), for the
 * HEAD request resolveSourceUrl makes. A URL mapped to the sentinel
 * `'THROW'` simulates a resolution failure (timeout, blocked HEAD, network
 * error). `pages` maps a (resolved) URL to the fake GET response
 * scrapeThumbnail makes against it: `status`/`contentType`/`html`, or
 * `throws` to simulate a network failure; a URL with no entry in `pages`
 * behaves as a failed GET (thumbnail scraping is best-effort, so most
 * tests that don't care about thumbnails can omit `pages` entirely). Also
 * counts every call (both HEAD and GET) so tests can assert a distinct URL
 * is only resolved/scraped once even if cited by multiple quotes. */
function fakeResolveFetch(
  resolutions: Record<string, string> = {},
  pages: Record<string, { status?: number; contentType?: string; html?: string; throws?: boolean }> = {},
): { fetchFn: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const fetchFn = (async (url: string | URL, init?: RequestInit) => {
    const key = String(url);
    calls.push(key);
    const method = init?.method ?? 'GET';
    if (method === 'HEAD') {
      if (resolutions[key] === 'THROW') throw new Error('simulated network failure');
      return { url: resolutions[key] ?? key } as Response;
    }
    const page = pages[key];
    if (!page || page.throws) throw new Error('simulated network failure');
    const status = page.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      url: key,
      headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? (page.contentType ?? 'text/html') : null) } as Headers,
      // Chunked (not one single enqueue) so a test can exercise the
      // byte-cap early-bailout: scrapeThumbnail's cap check only runs
      // between reads, so a single giant chunk would defeat it.
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          const bytes = new TextEncoder().encode(page.html ?? '');
          const chunkSize = 4096;
          for (let i = 0; i < bytes.length; i += chunkSize) controller.enqueue(bytes.slice(i, i + chunkSize));
          controller.close();
        },
      }),
    } as unknown as Response;
  }) as typeof fetch;
  return { fetchFn, calls };
}

// --- researchCompany: Gemini + Grounding with Google Search ---

test('returns the trimmed text from a successful Gemini call', async () => {
  const { client } = scriptedGeminiClient('  The company operates in a fast-growing, cyclical sector.  ');
  const result = await researchCompany('NVDA', null, { client });
  assert.equal(result.research, 'The company operates in a fast-growing, cyclical sector.');
});

test('requests the googleSearch grounding tool and names the ticker', async () => {
  const { client, params } = scriptedGeminiClient('Findings.');
  await researchCompany('NVDA', null, { client });
  const body = params[0] as { contents: string; config: { tools: Array<{ googleSearch?: unknown }> } };
  assert.match(body.contents, /NVDA/);
  assert.ok(body.config.tools.some((t) => 'googleSearch' in t), 'googleSearch tool should be offered');
});

test('omits any prior-research reference from contents when none is given', async () => {
  const { client, params } = scriptedGeminiClient('Findings.');
  await researchCompany('NVDA', null, { client });
  const body = params[0] as { contents: string };
  assert.doesNotMatch(body.contents, /Previous research summary/);
});

test('passes a given prior research summary into contents as a labeled reference', async () => {
  const { client, params } = scriptedGeminiClient('Findings.');
  await researchCompany('NVDA', 'NVIDIA leads the AI accelerator market.', { client });
  const body = params[0] as { contents: string };
  assert.match(body.contents, /Previous research summary for NVDA/);
  assert.match(body.contents, /NVIDIA leads the AI accelerator market\./);
});

test('throws when Gemini returns no usable text', async () => {
  const { client } = scriptedGeminiClient(undefined);
  await assert.rejects(() => researchCompany('NVDA', null, { client }), /no usable text/);
});

test('throws when Gemini returns only whitespace', async () => {
  const { client } = scriptedGeminiClient('   ');
  await assert.rejects(() => researchCompany('NVDA', null, { client }), /no usable text/);
});

test('returns no citations when the response carries no grounding metadata', async () => {
  const { client } = scriptedGeminiClient('Findings with no grounding.');
  const result = await researchCompany('NVDA', null, { client });
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
  const result = await researchCompany('GOOG', null, { client, resolveFetch: fetchFn });
  assert.deepEqual(result.citations, [
    {
      quote: 'Google Cloud grew 34% YoY.',
      sources: [
        { title: 'Reuters', url: 'https://reuters.com/tech/google-cloud-q3-2026', siteName: 'Reuters' },
        { title: 'Bloomberg', url: 'https://bloomberg.com/news/articles/google-cloud-growth', siteName: 'Bloomberg' },
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
  const result = await researchCompany('GOOG', null, { client, resolveFetch: fetchFn });
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
  const result = await researchCompany('GOOG', null, { client, resolveFetch: fetchFn });
  assert.deepEqual(calls, ['https://redirect/1', 'https://reuters.com/article']);
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
  const result = await researchCompany('GOOG', null, { client, resolveFetch: fetchFn });
  assert.equal(result.citations.length, 1);
  assert.equal(result.citations[0]!.quote, 'Sourced claim.');
});

// --- extractCitations: thumbnail scraping ---

function singleSourceCandidates() {
  return [
    {
      groundingMetadata: {
        groundingChunks: [{ web: { title: 'Reuters', uri: 'https://redirect/1' } }],
        groundingSupports: [{ segment: { text: 'A claim.' }, groundingChunkIndices: [0] }],
      },
    },
  ];
}

test('scrapes an og:image thumbnail from the resolved page', async () => {
  const { client } = scriptedGeminiClient('Findings.', singleSourceCandidates());
  const { fetchFn } = fakeResolveFetch(
    { 'https://redirect/1': 'https://reuters.com/article' },
    { 'https://reuters.com/article': { html: '<head><meta property="og:image" content="https://cdn.reuters.com/thumb.jpg"></head>' } },
  );
  const result = await researchCompany('GOOG', null, { client, resolveFetch: fetchFn });
  assert.equal(result.citations[0]!.sources[0]!.thumbnailUrl, 'https://cdn.reuters.com/thumb.jpg');
});

test('falls back to twitter:image when og:image is absent', async () => {
  const { client } = scriptedGeminiClient('Findings.', singleSourceCandidates());
  const { fetchFn } = fakeResolveFetch(
    { 'https://redirect/1': 'https://reuters.com/article' },
    { 'https://reuters.com/article': { html: '<head><meta name="twitter:image" content="https://cdn.reuters.com/tw.jpg"></head>' } },
  );
  const result = await researchCompany('GOOG', null, { client, resolveFetch: fetchFn });
  assert.equal(result.citations[0]!.sources[0]!.thumbnailUrl, 'https://cdn.reuters.com/tw.jpg');
});

test('prefers og:image over twitter:image when both are present', async () => {
  const { client } = scriptedGeminiClient('Findings.', singleSourceCandidates());
  const { fetchFn } = fakeResolveFetch(
    { 'https://redirect/1': 'https://reuters.com/article' },
    {
      'https://reuters.com/article': {
        html:
          '<head><meta name="twitter:image" content="https://cdn.reuters.com/tw.jpg">' +
          '<meta property="og:image" content="https://cdn.reuters.com/og.jpg"></head>',
      },
    },
  );
  const result = await researchCompany('GOOG', null, { client, resolveFetch: fetchFn });
  assert.equal(result.citations[0]!.sources[0]!.thumbnailUrl, 'https://cdn.reuters.com/og.jpg');
});

test('resolves a relative og:image URL against the resolved page URL', async () => {
  const { client } = scriptedGeminiClient('Findings.', singleSourceCandidates());
  const { fetchFn } = fakeResolveFetch(
    { 'https://redirect/1': 'https://reuters.com/article' },
    { 'https://reuters.com/article': { html: '<head><meta property="og:image" content="/img/thumb.jpg"></head>' } },
  );
  const result = await researchCompany('GOOG', null, { client, resolveFetch: fetchFn });
  assert.equal(result.citations[0]!.sources[0]!.thumbnailUrl, 'https://reuters.com/img/thumb.jpg');
});

test('omits thumbnailUrl when the page has no og:image or twitter:image tag', async () => {
  const { client } = scriptedGeminiClient('Findings.', singleSourceCandidates());
  const { fetchFn } = fakeResolveFetch(
    { 'https://redirect/1': 'https://reuters.com/article' },
    { 'https://reuters.com/article': { html: '<head><title>No image here</title></head>' } },
  );
  const result = await researchCompany('GOOG', null, { client, resolveFetch: fetchFn });
  assert.equal('thumbnailUrl' in result.citations[0]!.sources[0]!, false);
});

test('omits thumbnailUrl when the thumbnail GET fails, without affecting URL resolution', async () => {
  const { client } = scriptedGeminiClient('Findings.', singleSourceCandidates());
  const { fetchFn } = fakeResolveFetch(
    { 'https://redirect/1': 'https://reuters.com/article' },
    { 'https://reuters.com/article': { throws: true } },
  );
  const result = await researchCompany('GOOG', null, { client, resolveFetch: fetchFn });
  assert.equal(result.citations[0]!.sources[0]!.url, 'https://reuters.com/article');
  assert.equal('thumbnailUrl' in result.citations[0]!.sources[0]!, false);
});

test('omits thumbnailUrl for a non-200 response even if the body contains a usable tag', async () => {
  const { client } = scriptedGeminiClient('Findings.', singleSourceCandidates());
  const { fetchFn } = fakeResolveFetch(
    { 'https://redirect/1': 'https://reuters.com/article' },
    {
      'https://reuters.com/article': {
        status: 404,
        html: '<head><meta property="og:image" content="https://cdn.reuters.com/thumb.jpg"></head>',
      },
    },
  );
  const result = await researchCompany('GOOG', null, { client, resolveFetch: fetchFn });
  assert.equal('thumbnailUrl' in result.citations[0]!.sources[0]!, false);
});

test('omits thumbnailUrl for a non-HTML content-type', async () => {
  const { client } = scriptedGeminiClient('Findings.', singleSourceCandidates());
  const { fetchFn } = fakeResolveFetch(
    { 'https://redirect/1': 'https://reuters.com/article' },
    {
      'https://reuters.com/article': {
        contentType: 'application/pdf',
        html: '<head><meta property="og:image" content="https://cdn.reuters.com/thumb.jpg"></head>',
      },
    },
  );
  const result = await researchCompany('GOOG', null, { client, resolveFetch: fetchFn });
  assert.equal('thumbnailUrl' in result.citations[0]!.sources[0]!, false);
});

test('omits thumbnailUrl when the og:image tag sits beyond the byte cap', async () => {
  const { client } = scriptedGeminiClient('Findings.', singleSourceCandidates());
  const filler = '<!--' + 'x'.repeat(210 * 1024) + '-->';
  const { fetchFn } = fakeResolveFetch(
    { 'https://redirect/1': 'https://reuters.com/article' },
    { 'https://reuters.com/article': { html: `<head>${filler}<meta property="og:image" content="https://cdn.reuters.com/thumb.jpg"></head>` } },
  );
  const result = await researchCompany('GOOG', null, { client, resolveFetch: fetchFn });
  assert.equal('thumbnailUrl' in result.citations[0]!.sources[0]!, false);
});

// --- extractCitations: site name and article title scraping ---

test('scrapes siteName from og:site_name', async () => {
  const { client } = scriptedGeminiClient('Findings.', singleSourceCandidates());
  const { fetchFn } = fakeResolveFetch(
    { 'https://redirect/1': 'https://reuters.com/article' },
    { 'https://reuters.com/article': { html: '<head><meta property="og:site_name" content="Reuters"></head>' } },
  );
  const result = await researchCompany('GOOG', null, { client, resolveFetch: fetchFn });
  assert.equal(result.citations[0]!.sources[0]!.siteName, 'Reuters');
});

test('scrapes articleTitle from og:title', async () => {
  const { client } = scriptedGeminiClient('Findings.', singleSourceCandidates());
  const { fetchFn } = fakeResolveFetch(
    { 'https://redirect/1': 'https://reuters.com/article' },
    { 'https://reuters.com/article': { html: '<head><meta property="og:title" content="Cloud growth accelerates"></head>' } },
  );
  const result = await researchCompany('GOOG', null, { client, resolveFetch: fetchFn });
  assert.equal(result.citations[0]!.sources[0]!.articleTitle, 'Cloud growth accelerates');
});

test('falls back to the <title> tag when og:title is absent', async () => {
  const { client } = scriptedGeminiClient('Findings.', singleSourceCandidates());
  const { fetchFn } = fakeResolveFetch(
    { 'https://redirect/1': 'https://reuters.com/article' },
    { 'https://reuters.com/article': { html: '<head><title>Cloud growth accelerates</title></head>' } },
  );
  const result = await researchCompany('GOOG', null, { client, resolveFetch: fetchFn });
  assert.equal(result.citations[0]!.sources[0]!.articleTitle, 'Cloud growth accelerates');
});

test('prefers og:title over the <title> tag when both are present', async () => {
  const { client } = scriptedGeminiClient('Findings.', singleSourceCandidates());
  const { fetchFn } = fakeResolveFetch(
    { 'https://redirect/1': 'https://reuters.com/article' },
    {
      'https://reuters.com/article': {
        html: '<head><title>Reuters.com</title><meta property="og:title" content="Cloud growth accelerates"></head>',
      },
    },
  );
  const result = await researchCompany('GOOG', null, { client, resolveFetch: fetchFn });
  assert.equal(result.citations[0]!.sources[0]!.articleTitle, 'Cloud growth accelerates');
});

test('falls back to a hostname-derived siteName when the scrape fails entirely', async () => {
  const { client } = scriptedGeminiClient('Findings.', singleSourceCandidates());
  const { fetchFn } = fakeResolveFetch({ 'https://redirect/1': 'https://www.reuters.com/article' });
  const result = await researchCompany('GOOG', null, { client, resolveFetch: fetchFn });
  assert.equal(result.citations[0]!.sources[0]!.siteName, 'Reuters');
});

test('hostname-derived siteName uses the brand label, not a leading subdomain like "global"', async () => {
  const { client } = scriptedGeminiClient('Findings.', singleSourceCandidates());
  const { fetchFn } = fakeResolveFetch({ 'https://redirect/1': 'https://global.morningstar.com/en-gb/stocks/nvidia' });
  const result = await researchCompany('GOOG', null, { client, resolveFetch: fetchFn });
  assert.equal(result.citations[0]!.sources[0]!.siteName, 'Morningstar');
});

test('omits articleTitle when neither og:title nor a <title> tag is present', async () => {
  const { client } = scriptedGeminiClient('Findings.', singleSourceCandidates());
  const { fetchFn } = fakeResolveFetch(
    { 'https://redirect/1': 'https://reuters.com/article' },
    { 'https://reuters.com/article': { html: '<head><meta property="og:site_name" content="Reuters"></head>' } },
  );
  const result = await researchCompany('GOOG', null, { client, resolveFetch: fetchFn });
  assert.equal('articleTitle' in result.citations[0]!.sources[0]!, false);
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
    () => researchCompany('NVDA', null, { client }),
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
  await assert.rejects(() => researchCompany('NVDA', null, { client }), /invalid API key/);
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
  await assert.rejects(() => researchCompany('NVDA', null, { client, timeoutMs: 10 }), AdvisorWallClockTimeoutError);
});

// --- verifyTimeSensitiveClaims: dual-source corroboration for
// time-sensitive research quotes ---

/** A single-quote, single-source grounding fixture, for tests exercising
 * the time-sensitive-claim verification step; `quoteText` defaults to
 * something plausibly time-sensitive so classification tests don't need
 * to restate it. */
function singleSourceQuoteCandidates(quoteText = 'Revenue grew 34% in Q3 2026.', sourceUri = 'https://redirect/1') {
  return [
    {
      groundingMetadata: {
        groundingChunks: [{ web: { title: 'Reuters', uri: sourceUri } }],
        groundingSupports: [{ segment: { text: quoteText }, groundingChunkIndices: [0] }],
      },
    },
  ];
}

test('classifying no quotes as time-sensitive leaves citations unchanged, with no corroboration search', async () => {
  const { client: geminiClient, params } = scriptedGeminiClientSequence([
    { text: 'Findings.', candidates: singleSourceQuoteCandidates() },
  ]);
  const { client: claudeClient } = scriptedClaudeClient([{ content: [{ type: 'text', text: 'NONE' }] }]);
  const result = await researchCompany('GOOG', null, { client: geminiClient, claudeOptions: { client: claudeClient } });
  assert.equal(result.citations[0]!.sourceConfidence, undefined);
  assert.equal(result.citations[0]!.sources.length, 1);
  assert.equal(params.length, 1, 'no corroboration search should have been attempted');
});

test('skips the corroboration search for a time-sensitive quote that already has 2+ distinct-domain sources', async () => {
  const candidates = [
    {
      groundingMetadata: {
        groundingChunks: [
          { web: { title: 'Reuters', uri: 'https://redirect/1' } },
          { web: { title: 'Bloomberg', uri: 'https://redirect/2' } },
        ],
        groundingSupports: [{ segment: { text: 'Revenue grew 34% in Q3 2026.' }, groundingChunkIndices: [0, 1] }],
      },
    },
  ];
  const { client: geminiClient, params } = scriptedGeminiClientSequence([{ text: 'Findings.', candidates }]);
  const { client: claudeClient } = scriptedClaudeClient([{ content: [{ type: 'text', text: '0' }] }]);
  const { fetchFn } = fakeResolveFetch({
    'https://redirect/1': 'https://reuters.com/a',
    'https://redirect/2': 'https://bloomberg.com/b',
  });
  const result = await researchCompany('GOOG', null, { client: geminiClient, claudeOptions: { client: claudeClient }, resolveFetch: fetchFn });
  assert.equal(result.citations[0]!.sourceConfidence, undefined);
  assert.equal(params.length, 1, 'already independently corroborated; no search needed');
});

test('appends a second, independent source when corroboration finds one for a time-sensitive, single-sourced quote', async () => {
  const { client: geminiClient, params } = scriptedGeminiClientSequence([
    { text: 'Findings.', candidates: singleSourceQuoteCandidates() },
    { text: 'https://redirect/2' },
  ]);
  const { client: claudeClient } = scriptedClaudeClient([{ content: [{ type: 'text', text: '0' }] }]);
  const { fetchFn } = fakeResolveFetch({
    'https://redirect/1': 'https://reuters.com/a',
    'https://redirect/2': 'https://bloomberg.com/b',
  });
  const result = await researchCompany('GOOG', null, { client: geminiClient, claudeOptions: { client: claudeClient }, resolveFetch: fetchFn });
  assert.equal(result.citations[0]!.sourceConfidence, undefined);
  assert.equal(result.citations[0]!.sources.length, 2);
  assert.equal(result.citations[0]!.sources[1]!.url, 'https://bloomberg.com/b');
  assert.equal(params.length, 2);
  const searchContents = (params[1] as { contents: string }).contents;
  assert.match(searchContents, /reuters\.com/);
});

test('marks a time-sensitive, single-sourced quote as single-source when no corroboration is found', async () => {
  const { client: geminiClient } = scriptedGeminiClientSequence([
    { text: 'Findings.', candidates: singleSourceQuoteCandidates() },
    { text: 'NONE' },
  ]);
  const { client: claudeClient } = scriptedClaudeClient([{ content: [{ type: 'text', text: '0' }] }]);
  const { fetchFn } = fakeResolveFetch({ 'https://redirect/1': 'https://reuters.com/a' });
  const result = await researchCompany('GOOG', null, { client: geminiClient, claudeOptions: { client: claudeClient }, resolveFetch: fetchFn });
  assert.equal(result.citations[0]!.sourceConfidence, 'single-source');
  assert.equal(result.citations[0]!.sources.length, 1, 'the one real source is kept, not dropped');
});

test('does not count a "corroborating" source that turns out to be the same excluded domain', async () => {
  const { client: geminiClient } = scriptedGeminiClientSequence([
    { text: 'Findings.', candidates: singleSourceQuoteCandidates() },
    { text: 'https://reuters.com/a-different-article' },
  ]);
  const { client: claudeClient } = scriptedClaudeClient([{ content: [{ type: 'text', text: '0' }] }]);
  const { fetchFn } = fakeResolveFetch({
    'https://redirect/1': 'https://reuters.com/a',
    'https://reuters.com/a-different-article': 'https://reuters.com/a-different-article',
  });
  const result = await researchCompany('GOOG', null, { client: geminiClient, claudeOptions: { client: claudeClient }, resolveFetch: fetchFn });
  assert.equal(result.citations[0]!.sourceConfidence, 'single-source');
  assert.equal(result.citations[0]!.sources.length, 1);
});

test('gracefully leaves citations unverified when the classification call itself fails', async () => {
  const { client: geminiClient, params } = scriptedGeminiClientSequence([
    { text: 'Findings.', candidates: singleSourceQuoteCandidates() },
  ]);
  const claudeClient: AnthropicLike = {
    messages: {
      async create() {
        throw new Error('simulated Claude outage');
      },
    },
  };
  const result = await researchCompany('GOOG', null, { client: geminiClient, claudeOptions: { client: claudeClient } });
  assert.equal(result.citations[0]!.sourceConfidence, undefined);
  assert.equal(result.citations[0]!.sources.length, 1);
  assert.equal(params.length, 1, 'no corroboration search attempted once classification itself failed');
});

test('caps corroboration searches, but still marks every eligible quote single-source even past the cap', async () => {
  const candidates = [
    {
      groundingMetadata: {
        groundingChunks: [
          { web: { title: 'A', uri: 'https://redirect/a' } },
          { web: { title: 'B', uri: 'https://redirect/b' } },
          { web: { title: 'C', uri: 'https://redirect/c' } },
          { web: { title: 'D', uri: 'https://redirect/d' } },
          { web: { title: 'E', uri: 'https://redirect/e' } },
          { web: { title: 'F', uri: 'https://redirect/f' } },
        ],
        groundingSupports: [
          { segment: { text: 'Claim 0.' }, groundingChunkIndices: [0] },
          { segment: { text: 'Claim 1.' }, groundingChunkIndices: [1] },
          { segment: { text: 'Claim 2.' }, groundingChunkIndices: [2] },
          { segment: { text: 'Claim 3.' }, groundingChunkIndices: [3] },
          { segment: { text: 'Claim 4.' }, groundingChunkIndices: [4] },
          { segment: { text: 'Claim 5.' }, groundingChunkIndices: [5] },
        ],
      },
    },
  ];
  const { client: geminiClient, params } = scriptedGeminiClientSequence([
    { text: 'Findings.', candidates },
    { text: 'NONE' },
    { text: 'NONE' },
    { text: 'NONE' },
    { text: 'NONE' },
    { text: 'NONE' },
  ]);
  const { client: claudeClient } = scriptedClaudeClient([{ content: [{ type: 'text', text: '0,1,2,3,4,5' }] }]);
  const { fetchFn } = fakeResolveFetch(
    Object.fromEntries('abcdef'.split('').map((l) => [`https://redirect/${l}`, `https://site-${l}.example.com/`])),
  );
  const result = await researchCompany('GOOG', null, { client: geminiClient, claudeOptions: { client: claudeClient }, resolveFetch: fetchFn });
  assert.equal(params.length, 6, '1 main call + 5 corroboration searches (the cap), not 6');
  assert.ok(
    result.citations.every((c) => c.sourceConfidence === 'single-source'),
    'every eligible quote is marked single-source, including the one past the search cap',
  );
});

// --- checkForMaterialUpdates: the cheap refresh check ---

const NO_CONTEXT = { sinceDate: '2026-09-01', now: '2026-09-10', priorNextEarningsDate: null, priorResearch: null };

test('parses a NO response as no updates, with no earnings date given', async () => {
  const { client } = scriptedGeminiClient('NO');
  const result = await checkForMaterialUpdates('NVDA', NO_CONTEXT, { client });
  assert.equal(result.hasUpdates, false);
  assert.equal(result.summary, null);
  assert.equal(result.nextEarningsDate, null);
});

test('parses a YES response with an earnings date, its source domain, and a summary', async () => {
  const { client } = scriptedGeminiClient('YES\n2026-10-22\ninvestor.example.com\nThe company announced a major new product line.');
  const result = await checkForMaterialUpdates('NVDA', NO_CONTEXT, { client });
  assert.equal(result.hasUpdates, true);
  assert.equal(result.nextEarningsDate, '2026-10-22');
  assert.equal(result.summary, 'The company announced a major new product line.');
});

test('treats a literal UNKNOWN earnings-date line as no known date', async () => {
  const { client } = scriptedGeminiClient('NO\nUNKNOWN');
  const result = await checkForMaterialUpdates('NVDA', NO_CONTEXT, { client });
  assert.equal(result.nextEarningsDate, null);
});

test('treats an empty or malformed response as no updates and no known date', async () => {
  const { client } = scriptedGeminiClient(undefined);
  const result = await checkForMaterialUpdates('NVDA', NO_CONTEXT, { client });
  assert.equal(result.hasUpdates, false);
  assert.equal(result.summary, null);
  assert.equal(result.nextEarningsDate, null);
});

test('checkForMaterialUpdates passes the ticker, since-date, and today into the prompt', async () => {
  const { client, params } = scriptedGeminiClient('NO');
  await checkForMaterialUpdates('AAPL', { ...NO_CONTEXT, sinceDate: '2026-08-15' }, { client });
  const body = params[0] as { contents: string };
  assert.match(body.contents, /AAPL/);
  assert.match(body.contents, /2026-08-15/);
  assert.match(body.contents, /2026-09-10/);
});

test('reports the currently tracked earnings date as "not known" when none is given', async () => {
  const { client, params } = scriptedGeminiClient('NO');
  await checkForMaterialUpdates('AAPL', NO_CONTEXT, { client });
  const body = params[0] as { contents: string };
  assert.match(body.contents, /Currently tracked next earnings date: not known\./);
});

test('passes a given prior earnings date into contents as a starting point to confirm or correct', async () => {
  const { client, params } = scriptedGeminiClient('NO');
  await checkForMaterialUpdates('AAPL', { ...NO_CONTEXT, priorNextEarningsDate: '2026-10-22' }, { client });
  const body = params[0] as { contents: string };
  assert.match(body.contents, /Currently tracked next earnings date: 2026-10-22\./);
});

test('omits any prior-research reference from contents when none is given', async () => {
  const { client, params } = scriptedGeminiClient('NO');
  await checkForMaterialUpdates('AAPL', NO_CONTEXT, { client });
  const body = params[0] as { contents: string };
  assert.doesNotMatch(body.contents, /Existing research summary/);
});

test('passes a given prior research summary into contents as a labeled reference', async () => {
  const { client, params } = scriptedGeminiClient('NO');
  await checkForMaterialUpdates('AAPL', { ...NO_CONTEXT, priorResearch: 'Apple faces DOJ antitrust scrutiny.' }, { client });
  const body = params[0] as { contents: string };
  assert.match(body.contents, /Existing research summary to check against/);
  assert.match(body.contents, /Apple faces DOJ antitrust scrutiny\./);
});

// --- validateEarningsDate: deterministic checks on a model-reported date,
// exercised through checkForMaterialUpdates ---

test('a well-formed, non-stale date is used directly with no extra calls', async () => {
  const { client, params } = scriptedGeminiClient(`NO\n${FUTURE_EARNINGS_DATE}\ninvestor.example.com`);
  const result = await checkForMaterialUpdates('NVDA', NO_CONTEXT, { client });
  assert.equal(result.nextEarningsDate, FUTURE_EARNINGS_DATE);
  assert.equal(params.length, 1, 'no fallback parse or second search should have been attempted');
});

test('re-searches excluding the source domain when the found date is stale, and uses what it finds', async () => {
  const { client, params } = scriptedGeminiClientSequence([
    { text: 'NO\n2020-01-01\nstale-calendar.example.com' },
    { text: `${FUTURE_EARNINGS_DATE}\ninvestor.example.com` },
  ]);
  const result = await checkForMaterialUpdates('NVDA', NO_CONTEXT, { client });
  assert.equal(result.nextEarningsDate, FUTURE_EARNINGS_DATE);
  assert.equal(params.length, 2);
  const secondCallContents = (params[1] as { contents: string }).contents;
  assert.match(secondCallContents, /stale-calendar\.example\.com/);
});

test('reports missing when even the domain-excluded second search still finds a stale date', async () => {
  const { client } = scriptedGeminiClientSequence([
    { text: 'NO\n2020-01-01\nstale-calendar.example.com' },
    { text: '2020-06-01\nanother-stale-site.example.com' },
  ]);
  const result = await checkForMaterialUpdates('NVDA', NO_CONTEXT, { client });
  assert.equal(result.nextEarningsDate, null);
});

test('still attempts a second search when stale but no source domain was attributed, without an exclusion clause', async () => {
  const { client, params } = scriptedGeminiClientSequence([
    { text: 'NO\n2020-01-01\nNONE' },
    { text: `${FUTURE_EARNINGS_DATE}\ninvestor.example.com` },
  ]);
  const result = await checkForMaterialUpdates('NVDA', NO_CONTEXT, { client });
  assert.equal(result.nextEarningsDate, FUTURE_EARNINGS_DATE);
  const secondCallContents = (params[1] as { contents: string }).contents;
  assert.doesNotMatch(secondCallContents, /Do not use/);
});

test('salvages an unparseable date via the Claude fallback when it yields a valid, non-stale date', async () => {
  const { client: geminiClient } = scriptedGeminiClient('NO\nlate October next year\nexample.com');
  const { client: claudeClient } = scriptedClaudeClient([{ content: [{ type: 'text', text: FUTURE_EARNINGS_DATE }] }]);
  const result = await checkForMaterialUpdates('NVDA', NO_CONTEXT, {
    client: geminiClient,
    claudeOptions: { client: claudeClient },
  });
  assert.equal(result.nextEarningsDate, FUTURE_EARNINGS_DATE);
});

test('reports missing without a second search when the date is unparseable even after the Claude fallback', async () => {
  const { client: geminiClient, params } = scriptedGeminiClient('NO\ngarbage-not-a-date\nexample.com');
  const { client: claudeClient } = scriptedClaudeClient([{ content: [{ type: 'text', text: 'UNKNOWN' }] }]);
  const result = await checkForMaterialUpdates('NVDA', NO_CONTEXT, {
    client: geminiClient,
    claudeOptions: { client: claudeClient },
  });
  assert.equal(result.nextEarningsDate, null);
  assert.equal(params.length, 1, 'no domain-excluded second search should have been attempted');
});

test('still triggers the domain-excluded second search when the Claude-salvaged date turns out to be stale', async () => {
  const { client: geminiClient, params } = scriptedGeminiClientSequence([
    { text: 'NO\ngarbage-not-a-date\nstale-source.example.com' },
    { text: `${FUTURE_EARNINGS_DATE}\ninvestor.example.com` },
  ]);
  const { client: claudeClient } = scriptedClaudeClient([{ content: [{ type: 'text', text: '2020-01-01' }] }]);
  const result = await checkForMaterialUpdates('NVDA', NO_CONTEXT, {
    client: geminiClient,
    claudeOptions: { client: claudeClient },
  });
  assert.equal(result.nextEarningsDate, FUTURE_EARNINGS_DATE);
  assert.equal(params.length, 2);
  const secondCallContents = (params[1] as { contents: string }).contents;
  assert.match(secondCallContents, /stale-source\.example\.com/);
});

// --- scoreForRiskTolerance: a backtest-validating tool loop ---

test('validates with run_backtest before propose_settings is honored, then returns the proposal', async () => {
  const bars = syntheticBars();
  const { client, bodies } = scriptedClaudeClient([
    { content: [runBacktestBlock()] },
    { content: [proposeSettingsBlock()] },
  ]);
  const result = await scoreForRiskTolerance('NVDA', mkResearch('Some research findings.'), 'averse', bars, { client });
  assert.equal(result.rationale, 'Because the sector is trending.');
  assert.deepEqual(result.settings, VALID_SETTINGS);
  assert.equal(result.fit, 'within-bounds');
  assert.equal(result.nextEarningsDate, FUTURE_EARNINGS_DATE);
  assert.equal(result.earningsOutlook, 'Analysts expect revenue growth of 15% year over year.');
  assert.equal(result.earningsLikelihood, 'moderate');
  assert.equal(bodies.length, 2, 'one run_backtest turn, then one propose_settings turn');

  const firstBody = bodies[0] as { tools: Array<{ name: string }>; tool_choice: { type: string; name?: string } };
  assert.deepEqual(firstBody.tool_choice, { type: 'tool', name: 'run_backtest' }, 'first turn forces validation, not a free choice');
  assert.ok(!firstBody.tools.some((t) => t.name === 'web_search'), 'no web_search tool offered in the scoring step');

  const secondBody = bodies[1] as { tool_choice: { type: string } };
  assert.deepEqual(secondBody.tool_choice, { type: 'auto' }, 'model chooses to finalize once it has a backtest result');
});

test('ignores a propose_settings block appearing alongside run_backtest on the first (forced) turn', async () => {
  // Defense-in-depth: even if a response on the forced-run_backtest turn
  // also happened to carry a propose_settings block, it must not be
  // accepted as final before any real validation has happened.
  const bars = syntheticBars();
  const { client, bodies } = scriptedClaudeClient([
    { content: [runBacktestBlock(), proposeSettingsBlock()] },
    { content: [proposeSettingsBlock()] },
  ]);
  const result = await scoreForRiskTolerance('NVDA', mkResearch('research'), 'neutral', bars, { client });
  assert.equal(result.rationale, 'Because the sector is trending.');
  assert.equal(bodies.length, 2, 'the premature proposal on turn 1 was ignored; run_backtest was processed instead');
});

test('forces propose_settings once the backtest-call cap is reached', async () => {
  // The model keeps calling run_backtest past the cap; the loop must still
  // terminate by forcing propose_settings on the next turn rather than
  // looping forever.
  const bars = syntheticBars();
  const { client, bodies } = scriptedClaudeClient([
    { content: [runBacktestBlock({}, 'tu_a')] },
    { content: [runBacktestBlock({}, 'tu_b')] },
    { content: [runBacktestBlock({}, 'tu_c')] },
    { content: [proposeSettingsBlock()] },
  ]);
  const result = await scoreForRiskTolerance('NVDA', mkResearch('research'), 'neutral', bars, { client });
  assert.equal(result.rationale, 'Because the sector is trending.');
  assert.equal(bodies.length, 4, '3 backtest calls (the cap) + 1 forced finalize');
  const lastBody = bodies[3] as { tools: Array<{ name: string }>; tool_choice: { type: string; name?: string } };
  assert.deepEqual(lastBody.tool_choice, { type: 'tool', name: 'propose_settings' });
  assert.equal(lastBody.tools.length, 1, 'run_backtest is no longer offered once the cap is reached');
});

test('attaches a backtestResult reflecting the settings actually proposed, not an earlier candidate', async () => {
  const bars = syntheticBars();
  const { client } = scriptedClaudeClient([
    { content: [runBacktestBlock({ buyConsensus: 1, sellConsensus: 1 })] },
    { content: [proposeSettingsBlock({ settings: { ...VALID_SETTINGS, buyConsensus: 3, sellConsensus: 1 } })] },
  ]);
  const result = await scoreForRiskTolerance('NVDA', mkResearch('research'), 'neutral', bars, { client });
  assert.ok(result.backtestResult, 'a final validation backtest should be attached');
  assert.equal(typeof result.backtestResult!.strategyReturnPct, 'number');
  assert.equal(typeof result.backtestResult!.buyAndHoldReturnPct, 'number');
  assert.ok(Array.isArray(result.backtestResult!.trades));
});

test('substitutes an earlier candidate\'s settings when it performed meaningfully better', async () => {
  // On oscillatingBars, a loose (bc1/sc1) candidate genuinely outperforms
  // the model's own final (default bc2/sc3) proposal by a wide, real
  // margin -- the model saw this exact result in its own conversation
  // (the run_backtest tool_result) but "chose" to finalize on the worse
  // settings anyway, which is exactly the gap this guard exists for.
  const bars = oscillatingBars();
  const { client } = scriptedClaudeClient([
    { content: [runBacktestBlock({ buyConsensus: 1, sellConsensus: 1 })] },
    { content: [proposeSettingsBlock({ settings: VALID_SETTINGS })] },
  ]);
  const result = await scoreForRiskTolerance('NVDA', mkResearch('research'), 'neutral', bars, { client });
  assert.equal(result.settings.buyConsensus, 1, 'substituted in the better-performing candidate, not the final proposal');
  assert.equal(result.settings.sellConsensus, 1);
  assert.ok(result.backtestResult, 'the substituted candidate\'s own real result is attached');
  assert.ok(result.backtestResult!.trades.length > 0, 'the substituted candidate is functional');
  assert.ok(result.backtestResult!.strategyReturnPct > 50, 'reflects the candidate\'s real (much better) return, not the proposal\'s');
  assert.match(result.rationale, /\[Automatic adjustment]/, 'the swap is disclosed in the displayed rationale');
});

test('does not substitute when an earlier candidate is only marginally better', async () => {
  // Both combos trade and perform well on oscillatingBars; the gap between
  // them (real numbers, not scripted) is under MEANINGFUL_IMPROVEMENT_PCT,
  // so the model's own final choice should stand rather than being swapped
  // out over noise.
  const bars = oscillatingBars();
  const { client } = scriptedClaudeClient([
    { content: [runBacktestBlock({ buyConsensus: 1, sellConsensus: 1 })] },
    { content: [proposeSettingsBlock({ settings: { ...VALID_SETTINGS, buyConsensus: 1, sellConsensus: 1, persistenceBars: 3 } })] },
  ]);
  const result = await scoreForRiskTolerance('NVDA', mkResearch('research'), 'neutral', bars, { client });
  assert.equal(result.settings.persistenceBars, 3, 'kept the model\'s own final proposal; the gap was not meaningful');
  assert.doesNotMatch(result.rationale, /\[Automatic adjustment]/);
});

test('never substitutes a zero-trade earlier candidate, even when its return nominally looks better', async () => {
  // On downtrendBars, an over-restrictive earlier candidate never trades at
  // all (0%), which numerically "beats" the final proposal's real loss --
  // but a 0% from never entering a position is the paralysis failure mode
  // this loop exists to catch, not a genuine result to prefer.
  const bars = downtrendBars();
  const { client } = scriptedClaudeClient([
    { content: [runBacktestBlock({ persistenceBars: 8 })] },
    { content: [proposeSettingsBlock({ settings: VALID_SETTINGS })] },
  ]);
  const result = await scoreForRiskTolerance('NVDA', mkResearch('research'), 'neutral', bars, { client });
  assert.equal(result.settings.persistenceBars, 1, 'kept the model\'s own final proposal; the candidate never traded');
  assert.ok(result.backtestResult!.strategyReturnPct < 0, 'the kept proposal is a real, if unfortunate, loss');
  assert.doesNotMatch(result.rationale, /\[Automatic adjustment]/);
});

test('backtestResult is null when the final validation run itself fails', async () => {
  // Fewer than 2 bars makes runBacktest throw; the proposal is still
  // returned, just without an attached backtestResult.
  const oneBar = syntheticBars(1);
  const { client } = scriptedClaudeClient([
    { content: [runBacktestBlock()] },
    { content: [proposeSettingsBlock()] },
  ]);
  await assert.rejects(
    () => scoreForRiskTolerance('NVDA', mkResearch('research'), 'neutral', oneBar, { client }),
    /need at least 2 bars/,
    'the reference backtest itself needs 2+ bars, so this fails before Claude is even called',
  );
});

test('passes the ticker, research, citations, and risk tolerance label into the user message', async () => {
  const bars = syntheticBars();
  const { client, bodies } = scriptedClaudeClient([
    { content: [runBacktestBlock()] },
    { content: [proposeSettingsBlock()] },
  ]);
  const research = mkResearch('Findings about Apple.', [
    { quote: 'Apple beat EPS estimates.', sources: [{ title: 'Reuters', url: 'https://x' }] },
  ]);
  await scoreForRiskTolerance('AAPL', research, 'seeking', bars, { client });
  const body = bodies[0] as { messages: Array<{ content: string }> };
  const userContent = body.messages[0]!.content;
  assert.match(userContent, /AAPL/);
  assert.match(userContent, /Findings about Apple\./);
  assert.match(userContent, /risk-seeking/);
  assert.match(userContent, /\[0\] "Apple beat EPS estimates\." \(sources: Reuters\)/);
});

test('resolves claims and citation indices into fieldCitations', async () => {
  const bars = syntheticBars();
  const research = mkResearch('Findings.', [
    { quote: 'Quote A.', sources: [{ title: 'Reuters', url: 'https://a' }] },
    { quote: 'Quote B.', sources: [{ title: 'Bloomberg', url: 'https://b' }] },
  ]);
  const { client } = scriptedClaudeClient([
    { content: [runBacktestBlock()] },
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
  const result = await scoreForRiskTolerance('NVDA', research, 'neutral', bars, { client });
  assert.deepEqual(result.fieldCitations.rationale, [{ claim: 'Claim A.', quotes: [research.citations[0]] }]);
  assert.deepEqual(result.fieldCitations.fitReason, [{ claim: 'Claim B.', quotes: [research.citations[1]] }]);
  assert.deepEqual(result.fieldCitations.earningsOutlook, [{ claim: 'Claim C.', quotes: research.citations }]);
  assert.deepEqual(result.fieldCitations.earningsLikelihoodReason, []);
});

test('drops out-of-range or malformed citation indices within a claim rather than throwing', async () => {
  const bars = syntheticBars();
  const research = mkResearch('Findings.', [
    { quote: 'Quote A.', sources: [{ title: 'Reuters', url: 'https://a' }] },
  ]);
  const { client } = scriptedClaudeClient([
    { content: [runBacktestBlock()] },
    { content: [proposeSettingsBlock({ rationaleClaims: [{ claim: 'Claim A.', citationIndices: [0, 5, -1, 'x'] }] })] },
  ]);
  const result = await scoreForRiskTolerance('NVDA', research, 'neutral', bars, { client });
  assert.deepEqual(result.fieldCitations.rationale, [{ claim: 'Claim A.', quotes: [research.citations[0]] }]);
});

test('keeps a claim with zero resolvable quotes rather than dropping it', async () => {
  const bars = syntheticBars();
  const research = mkResearch('Findings.', [
    { quote: 'Quote A.', sources: [{ title: 'Reuters', url: 'https://a' }] },
  ]);
  const { client } = scriptedClaudeClient([
    { content: [runBacktestBlock()] },
    { content: [proposeSettingsBlock({ rationaleClaims: [{ claim: 'Pure synthesis, nothing directly citable.', citationIndices: [] }] })] },
  ]);
  const result = await scoreForRiskTolerance('NVDA', research, 'neutral', bars, { client });
  assert.deepEqual(result.fieldCitations.rationale, [{ claim: 'Pure synthesis, nothing directly citable.', quotes: [] }]);
});

test('drops a malformed claim entry (missing/non-string claim) rather than throwing', async () => {
  const bars = syntheticBars();
  const research = mkResearch('Findings.', []);
  const { client } = scriptedClaudeClient([
    { content: [runBacktestBlock()] },
    { content: [proposeSettingsBlock({ rationaleClaims: [{ citationIndices: [] }, { claim: '', citationIndices: [] }] })] },
  ]);
  const result = await scoreForRiskTolerance('NVDA', research, 'neutral', bars, { client });
  assert.deepEqual(result.fieldCitations.rationale, []);
});

test('rejects a proposal with an out-of-range field', async () => {
  const bars = syntheticBars();
  const { client } = scriptedClaudeClient([
    { content: [runBacktestBlock()] },
    { content: [proposeSettingsBlock({ settings: { ...VALID_SETTINGS, buyConsensus: 99 } })] },
  ]);
  await assert.rejects(() => scoreForRiskTolerance('NVDA', mkResearch('research'), 'neutral', bars, { client }), /outside the allowed range/);
});

test('rejects a proposal with an invalid fit value', async () => {
  const bars = syntheticBars();
  const { client } = scriptedClaudeClient([
    { content: [runBacktestBlock()] },
    { content: [proposeSettingsBlock({ fit: 'sure-why-not' })] },
  ]);
  await assert.rejects(() => scoreForRiskTolerance('NVDA', mkResearch('research'), 'neutral', bars, { client }), /must be one of/);
});

test('rejects a proposal missing fitReason', async () => {
  const bars = syntheticBars();
  const { client } = scriptedClaudeClient([
    { content: [runBacktestBlock()] },
    { content: [proposeSettingsBlock({ fitReason: '' })] },
  ]);
  await assert.rejects(() => scoreForRiskTolerance('NVDA', mkResearch('research'), 'neutral', bars, { client }), /fitReason/);
});

test('rejects a proposal with an invalid earningsLikelihood value', async () => {
  const bars = syntheticBars();
  const { client } = scriptedClaudeClient([
    { content: [runBacktestBlock()] },
    { content: [proposeSettingsBlock({ earningsLikelihood: 'super-high' })] },
  ]);
  await assert.rejects(() => scoreForRiskTolerance('NVDA', mkResearch('research'), 'neutral', bars, { client }), /earningsLikelihood/);
});

test('rejects a proposal missing earningsOutlook', async () => {
  const bars = syntheticBars();
  const { client } = scriptedClaudeClient([
    { content: [runBacktestBlock()] },
    { content: [proposeSettingsBlock({ earningsOutlook: '' })] },
  ]);
  await assert.rejects(() => scoreForRiskTolerance('NVDA', mkResearch('research'), 'neutral', bars, { client }), /earningsOutlook/);
});

test('accepts and normalizes a null nextEarningsDate', async () => {
  const bars = syntheticBars();
  const { client } = scriptedClaudeClient([
    { content: [runBacktestBlock()] },
    { content: [proposeSettingsBlock({ nextEarningsDate: null })] },
  ]);
  const result = await scoreForRiskTolerance('NVDA', mkResearch('research'), 'neutral', bars, { client });
  assert.equal(result.nextEarningsDate, null);
});

test('validates the finalized nextEarningsDate, correcting a stale one via a domain-excluded search', async () => {
  const bars = syntheticBars();
  const { client } = scriptedClaudeClient([
    { content: [runBacktestBlock()] },
    {
      content: [
        proposeSettingsBlock({ nextEarningsDate: '2020-01-01', nextEarningsDateSource: 'stale-site.example.com' }),
      ],
    },
  ]);
  const { client: geminiClient, params } = scriptedGeminiClient(`${FUTURE_EARNINGS_DATE}\ninvestor.example.com`);
  const result = await scoreForRiskTolerance('NVDA', mkResearch('research'), 'neutral', bars, {
    client,
    earningsDateGeminiOptions: { client: geminiClient },
  });
  assert.equal(result.nextEarningsDate, FUTURE_EARNINGS_DATE);
  assert.match((params[0] as { contents: string }).contents, /stale-site\.example\.com/);
});

test('strips stray trailing pseudo-XML scaffolding from rationale, fitReason, and earnings fields', async () => {
  const bars = syntheticBars();
  const { client } = scriptedClaudeClient([
    { content: [runBacktestBlock()] },
    { content: [proposeSettingsBlock({
      rationale: 'Because the sector is trending.</rationale>\n',
      fitReason: 'A real reason.</fitReason>\n</invoke>\n',
      earningsOutlook: 'Analysts expect growth.</earningsOutlook>\n',
      earningsLikelihoodReason: 'Beat history supports this.</earningsLikelihoodReason>\n</invoke>\n',
    })] },
  ]);
  const result = await scoreForRiskTolerance('NVDA', mkResearch('research'), 'neutral', bars, { client });
  assert.equal(result.rationale, 'Because the sector is trending.');
  assert.equal(result.fitReason, 'A real reason.');
  assert.equal(result.earningsOutlook, 'Analysts expect growth.');
  assert.equal(result.earningsLikelihoodReason, 'Beat history supports this.');
});

test('scoreForRiskTolerance translates a 529 overloaded error into a friendly AdvisorUpstreamError', async () => {
  const bars = syntheticBars();
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
    () => scoreForRiskTolerance('NVDA', mkResearch('research'), 'neutral', bars, { client }),
    (err: unknown) => {
      assert.ok(err instanceof AdvisorUpstreamError);
      assert.equal(err.status, 529);
      return true;
    },
  );
});

test('scoreForRiskTolerance throws AdvisorWallClockTimeoutError when the call runs past timeoutMs', async () => {
  const bars = syntheticBars();
  const client: AnthropicLike = {
    messages: {
      async create() {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return { content: [runBacktestBlock()] };
      },
    },
  };
  await assert.rejects(
    () => scoreForRiskTolerance('NVDA', mkResearch('research'), 'neutral', bars, { client, timeoutMs: 10 }),
    AdvisorWallClockTimeoutError,
  );
});
