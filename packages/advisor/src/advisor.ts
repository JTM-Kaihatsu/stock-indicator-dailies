import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';

import {
  PROPOSE_SETTINGS_TOOL,
  validateRiskScoredProposal,
  type ResearchCitation,
  type ResearchProposal,
  type RiskScoredProposal,
  type RiskTolerance,
} from './tool.ts';

export const DEFAULT_MODEL = 'claude-sonnet-5';
export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';
export const DEFAULT_MAX_TOKENS = 4096;
/** Wall-clock cap on one call; protects against the model simply being
 * slow (or a hung request) regardless of which provider is involved. */
export const DEFAULT_TIMEOUT_MS = 60_000;
/** This is a background job, not a synchronous request on the critical
 * path, so it can afford to absorb more of Anthropic's transient
 * 429/5xx/529 responses than the SDK's own default of 2 before giving up.
 * The SDK already applies exponential backoff between attempts. */
export const DEFAULT_MAX_RETRIES = 5;

/** The slice of the Anthropic SDK this depends on; narrow and injectable,
 * same testability pattern as packages/vlm/src/providers/claude.ts. */
export interface AnthropicLike {
  messages: {
    create(body: Record<string, unknown>): Promise<{
      content: Array<{ type: string; [key: string]: unknown }>;
      stop_reason?: string | null;
    }>;
  };
}

interface GeminiGroundingChunk {
  web?: { title?: string; uri?: string };
}

interface GeminiGroundingSupport {
  segment?: { text?: string };
  groundingChunkIndices?: number[];
}

interface GeminiResponse {
  text?: string;
  candidates?: Array<{
    groundingMetadata?: {
      groundingChunks?: GeminiGroundingChunk[];
      groundingSupports?: GeminiGroundingSupport[];
    };
  }>;
}

/** The slice of the Gemini SDK this depends on; narrow and injectable, same
 * testability pattern as AnthropicLike above. */
export interface GeminiLike {
  models: {
    generateContent(params: Record<string, unknown>): Promise<GeminiResponse>;
  };
}

/** Turns Gemini's grounding metadata (which segments of its response text
 * were backed by which web sources) into our own ResearchCitation shape.
 * Drops a support with no text, no attributed chunks, or chunks with no
 * usable URI; best-effort, since a citation we can't fully resolve is
 * useless for display anyway. */
function extractCitations(response: GeminiResponse): ResearchCitation[] {
  const metadata = response.candidates?.[0]?.groundingMetadata;
  const chunks = metadata?.groundingChunks ?? [];
  const supports = metadata?.groundingSupports ?? [];

  const citations: ResearchCitation[] = [];
  for (const support of supports) {
    const claim = support.segment?.text?.trim();
    if (!claim) continue;
    const sources = (support.groundingChunkIndices ?? [])
      .map((i) => chunks[i]?.web)
      .filter((web): web is { title?: string; uri: string } => typeof web?.uri === 'string')
      .map((web) => ({ title: web.title?.trim() || web.uri, url: web.uri }));
    if (sources.length === 0) continue;
    citations.push({ claim, sources });
  }
  return citations;
}

/** researchCompany now runs on Gemini + Grounding with Google Search (see
 * module docs in tool.ts for why); its options are shaped for that
 * provider, not Anthropic's. */
export interface ResearchOptions {
  /** Defaults to `process.env.GEMINI_API_KEY`. */
  apiKey?: string;
  model?: string;
  maxOutputTokens?: number;
  timeoutMs?: number;
  client?: GeminiLike;
}

/** scoreForRiskTolerance stays on Claude: a single forced tool call, no
 * search, synthesizing whatever researchCompany (now Gemini-backed)
 * gathered into structured settings + rationale + fit + earnings outlook. */
export interface ScoreOptions {
  /** Defaults to `process.env.VLM_API_KEY`; same key already used for the
   * chart-reading VLM calls, since both are Claude API usage. */
  apiKey?: string;
  model?: string;
  maxTokens?: number;
  timeoutMs?: number;
  /** Only applies when `client` is not supplied; ignored for an injected
   * test client, which has no retry behavior of its own. */
  maxRetries?: number;
  client?: AnthropicLike;
}

export class AdvisorWallClockTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`advisor did not finish within ${timeoutMs}ms`);
    this.name = 'AdvisorWallClockTimeoutError';
  }
}

/** The upstream API (Claude or Gemini) returned a transient error (rate
 * limit, overload, or a 5xx) after any of the provider's own retries were
 * exhausted. Distinct from AdvisorWallClockTimeoutError (the whole call ran
 * too long); this one means the upstream API itself was unavailable, and
 * trying again shortly is likely to work. */
export class AdvisorUpstreamError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'AdvisorUpstreamError';
    this.status = status;
  }
}

const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504, 529]);

/** Duck-typed status extraction so this works against both providers' SDKs
 * (Anthropic's APIError and Gemini's ApiError both carry a numeric
 * `.status`) and any fake client tests throw. */
function extractStatus(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null || !('status' in err)) return undefined;
  const status = (err as { status?: unknown }).status;
  return typeof status === 'number' ? status : undefined;
}

function friendlyClaudeUpstreamMessage(status: number): string {
  if (status === 529) {
    return "Claude's API is temporarily overloaded. This usually clears up within a minute; please try again shortly.";
  }
  if (status === 429) {
    return "Hit Claude's API rate limit. Please wait a moment and try again.";
  }
  return `Claude's API returned an unexpected error (HTTP ${status}). Please try again shortly.`;
}

function friendlyGeminiUpstreamMessage(status: number): string {
  if (status === 503) {
    return "Gemini's API is temporarily overloaded. This usually clears up within a minute; please try again shortly.";
  }
  if (status === 429) {
    return "Hit Gemini's API rate limit. Please wait a moment and try again.";
  }
  return `Gemini's API returned an unexpected error (HTTP ${status}). Please try again shortly.`;
}

/** Wraps a Claude call so scoring translates a transient upstream error
 * (rate limit, overload, 5xx) into AdvisorUpstreamError, instead of letting
 * the SDK's raw error escape. */
async function createClaudeMessage(
  client: AnthropicLike,
  body: Record<string, unknown>,
): Promise<Awaited<ReturnType<AnthropicLike['messages']['create']>>> {
  try {
    return await client.messages.create(body);
  } catch (err) {
    const status = extractStatus(err);
    if (status !== undefined && RETRYABLE_STATUSES.has(status)) {
      throw new AdvisorUpstreamError(status, friendlyClaudeUpstreamMessage(status));
    }
    throw err;
  }
}

/** Same wrapping as createClaudeMessage, for Gemini's client shape. */
async function createGeminiContent(
  client: GeminiLike,
  params: Record<string, unknown>,
): Promise<GeminiResponse> {
  try {
    return await client.models.generateContent(params);
  } catch (err) {
    const status = extractStatus(err);
    if (status !== undefined && RETRYABLE_STATUSES.has(status)) {
      throw new AdvisorUpstreamError(status, friendlyGeminiUpstreamMessage(status));
    }
    throw err;
  }
}

function buildClaudeClient(options: { apiKey?: string; maxRetries?: number; client?: AnthropicLike }): AnthropicLike {
  return (
    options.client ??
    (new Anthropic({
      apiKey: options.apiKey ?? process.env.VLM_API_KEY,
      maxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES,
    }) as unknown as AnthropicLike)
  );
}

function buildGeminiClient(options: { apiKey?: string; client?: GeminiLike }): GeminiLike {
  return (
    options.client ??
    (new GoogleGenAI({ apiKey: options.apiKey ?? process.env.GEMINI_API_KEY }) as unknown as GeminiLike)
  );
}

/** Races `work` against a wall-clock timeout, translating a timeout into
 * AdvisorWallClockTimeoutError. Shared by both stages. */
async function withWallClock<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AdvisorWallClockTimeoutError(timeoutMs)), timeoutMs);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

function findToolUse(content: Array<{ type: string; [key: string]: unknown }>, name: string) {
  return content.find((block) => block.type === 'tool_use' && block.name === name) as
    | { type: 'tool_use'; id: string; name: string; input: unknown }
    | undefined;
}

const GEMINI_RESEARCH_PROMPT = `You are researching a public company to build a reusable research brief for a
technical-analysis trading tool. This brief will be used later, in a separate step you are not doing here, to
tune indicator settings for different investor risk tolerances and to judge whether the stock suits each one;
write it to stand on its own, not slanted toward any one risk profile.

Use Google Search to research the company:
- Its industry and sector, current trends affecting it, recent relevant news, its competitors, and how volatile
  or speculative its stock currently is.
- Its next scheduled earnings report: the exact date if officially confirmed by the company, or an estimated
  date or range if not yet confirmed (many companies' earnings dates can be estimated weeks or months ahead
  from their historical reporting pattern, even before an official confirmation; report that estimate rather
  than omitting the date entirely, and say plainly whether it's confirmed or estimated). Also cover what
  analysts expect and are watching for, and the upside if those expectations are met or beaten.
- How likely those expectations are to be met, reasoned from the company's own historical pattern of beating or
  missing expectations, current industry trends, and any relevant political or regulatory news that could help
  or hinder it (e.g. tariffs, regulation, supply constraints, public sentiment). Ground this in what you find
  for THIS company; do not assume any particular kind of catalyst applies.

Base your findings on what you find via search, not general knowledge alone. Write a single findings summary,
covering both the general company research and the earnings outlook above, as prose (4-10 sentences). Respond
with only that summary; no preamble, no headers.`;

/** Researches `ticker`'s company via Gemini + Grounding with Google Search
 * and returns a reusable research brief. Stage 1 of 2 (see
 * scoreForRiskTolerance for stage 2); split out so the expensive,
 * search-backed part is cacheable per ticker regardless of which risk
 * tolerance ends up being scored against it. Gemini's grounding tool
 * decides its own search queries within this one call, the same way
 * Claude's hosted web_search tool did when this stage used to run there. */
export async function researchCompany(ticker: string, options: ResearchOptions = {}): Promise<ResearchProposal> {
  const model = options.model ?? DEFAULT_GEMINI_MODEL;
  const maxOutputTokens = options.maxOutputTokens ?? DEFAULT_MAX_TOKENS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const client = buildGeminiClient(options);

  const work = (async () => {
    const response = await createGeminiContent(client, {
      model,
      contents: `Research ${ticker} and write the findings summary.`,
      config: {
        systemInstruction: GEMINI_RESEARCH_PROMPT,
        tools: [{ googleSearch: {} }],
        maxOutputTokens,
      },
    });
    const research = (response.text ?? '').trim();
    if (research.length === 0) {
      throw new Error('Gemini research call returned no usable text');
    }
    return { research, citations: extractCitations(response) };
  })();

  return withWallClock(work, timeoutMs);
}

const MATERIAL_UPDATE_CHECK_PROMPT = `You are checking whether anything materially significant has happened for a
public company since a given date, for someone deciding whether their existing investment research is still
current. Use Google Search to check for major company-specific news, significant industry trends or news, and
related political or regulatory news since that date. Only report something if it is significant enough that it
would change an investment research brief; ignore routine, minor, or already-expected news.

Respond in exactly this format, nothing else:
Line 1: YES or NO
Line 2 (only if YES): a 1-2 sentence summary of what changed.`;

export interface MaterialUpdateCheck {
  hasUpdates: boolean;
  summary: string | null;
}

/** A cheap alternative to a full re-research: checks whether anything
 * material has happened for `ticker` since `sinceDate` (company, industry,
 * or political/regulatory news), for the "refresh" flow in
 * apps/api/src/advisorJobs.ts. `sinceDate` and `now` are both caller-
 * supplied (real server clock, not the model's own sense of the date) so
 * this can't drift from what the cache's own freshness check is using. */
export async function checkForMaterialUpdates(
  ticker: string,
  sinceDate: string,
  now: string,
  options: ResearchOptions = {},
): Promise<MaterialUpdateCheck> {
  const model = options.model ?? DEFAULT_GEMINI_MODEL;
  const maxOutputTokens = options.maxOutputTokens ?? 512;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const client = buildGeminiClient(options);

  const work = (async () => {
    const response = await createGeminiContent(client, {
      model,
      contents: `Ticker: ${ticker}. Today's date is ${now}. Check for material news since ${sinceDate}.`,
      config: {
        systemInstruction: MATERIAL_UPDATE_CHECK_PROMPT,
        tools: [{ googleSearch: {} }],
        maxOutputTokens,
      },
    });
    const text = (response.text ?? '').trim();
    const firstLine = (text.split('\n')[0] ?? '').trim().toUpperCase();
    const hasUpdates = firstLine.startsWith('YES');
    const summary = hasUpdates ? text.split('\n').slice(1).join('\n').trim() || null : null;
    return { hasUpdates, summary };
  })();

  return withWallClock(work, timeoutMs);
}

const SCORE_SYSTEM_PROMPT = `You are tuning a technical-analysis trading tool's indicator settings for one
stock, for an investor with a specific, stated risk tolerance. You are given a research brief gathered
separately in an earlier step, and a numbered list of specific claims from that research with their sources; no
search tool is available here, so work only from what you're given.

Investor risk tolerance definitions:
- risk-averse: prefers certainty and will choose the lower-risk option. Favor settings that require strong
  confirmation before acting and cut losses quickly.
- risk-neutral: ignores the element of danger and operates only by mathematical payoff. Use moderate, balanced
  settings.
- risk-seeking: intends fast bets and is comfortable with larger swings for a chance at bigger, quicker gains.
  Favor settings that react quickly and tolerate deeper drawdowns before exiting.

Using the research and whichever one of these is stated in the request, you must:
1. Propose specific settings tuned for that risk tolerance.
2. Judge the "fit": whether the STOCK ITSELF, per the research, actually suits that risk tolerance, independent
   of how you tuned the settings. Tuning settings defensively does not make an unsuitable stock
   "within-bounds"; judge the company, not the knobs. Reserve "caution"/"not-recommended" for a genuine
   mismatch the research supports (e.g. a risk-averse investor and a stock the research shows is unusually
   volatile, speculative, or driven by frequent, hard-to-predict catalysts), not routine market movement.
3. Extract the earnings outlook from the research: the next earnings date if the research gives one, confirmed
   or estimated (resolve an estimated range to its earlier end; null only if the research gives no timing
   indication at all), what analysts expect and the upside if achieved, and a likelihood assessment
   (low/moderate/high) for whether those expectations will be met, reasoned from the company's historical
   earnings pattern, current industry trends, and any political/regulatory factors the research covers. If the
   date is an estimate rather than officially confirmed, say so in earningsOutlook. If the research doesn't
   cover earnings specifics for this company at all, say so honestly in earningsOutlook rather than inventing
   detail, and reason earningsLikelihood from whatever general volatility/predictability information the
   research does contain.
4. For each of rationale, fitReason, earningsOutlook, and earningsLikelihoodReason, list which of the numbered
   research claims (if any) it draws on, as an array of indices in the matching *Citations field (e.g.
   rationaleCitations for rationale). Only cite a claim that field actually relies on; an empty array is normal
   and expected when a field is your own reasoning/synthesis rather than a specific claim from the research.
   Never cite a claim to a field it doesn't actually support just to fill in a citation.

You MUST end by calling propose_settings exactly once, as your final action, with a rationale, the settings,
the fit verdict + its reason, the earnings outlook fields, and the citation fields. Do not give your answer as
plain text.`;

const RISK_TOLERANCE_LABELS: Record<RiskTolerance, string> = {
  averse: 'risk-averse',
  neutral: 'risk-neutral',
  seeking: 'risk-seeking',
};

/** Formats research citations as a numbered list for the scoring prompt,
 * e.g. `[0] "Google Cloud grew 34% YoY..." (sources: Reuters, Bloomberg)`.
 * Claude references these back by index in its own citation fields; it
 * never needs to reproduce the URL itself, so this stays compact. Empty
 * string (not an empty list rendering) when there are no citations, so the
 * prompt doesn't dangle an empty header. */
function formatCitationsList(citations: readonly ResearchCitation[]): string {
  if (citations.length === 0) return '(no specific sourced claims available)';
  return citations
    .map((c, i) => `[${i}] "${c.claim}" (sources: ${c.sources.map((s) => s.title).join(', ')})`)
    .join('\n');
}

/** Scores an already-researched company against one investor risk
 * tolerance: proposes tuned settings, judges whether the stock itself
 * suits that stance, and extracts an earnings outlook. Stage 2 of 2 (see
 * researchCompany); a single forced tool call, no search; meant to be
 * cheap and fast enough to re-run per risk tolerance without
 * re-researching. */
export async function scoreForRiskTolerance(
  ticker: string,
  research: ResearchProposal,
  riskTolerance: RiskTolerance,
  options: ScoreOptions = {},
): Promise<RiskScoredProposal> {
  const model = options.model ?? DEFAULT_MODEL;
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const client = buildClaudeClient(options);

  const work = (async () => {
    const response = await createClaudeMessage(client, {
      model,
      max_tokens: maxTokens,
      system: [{ type: 'text', text: SCORE_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      tools: [PROPOSE_SETTINGS_TOOL],
      tool_choice: { type: 'tool', name: 'propose_settings' },
      messages: [
        {
          role: 'user',
          content:
            `Research on ${ticker}:\n${research.research}\n\n` +
            `Numbered source citations for the research above:\n${formatCitationsList(research.citations)}\n\n` +
            `Investor risk tolerance: ${RISK_TOLERANCE_LABELS[riskTolerance]}\n\n` +
            'Propose settings and judge fit.',
        },
      ],
    });

    const proposal = findToolUse(response.content, 'propose_settings');
    if (!proposal) {
      // tool_choice forces the model to call this tool; reaching here would
      // mean the API itself misbehaved, not a model choice to skip it.
      throw new Error('propose_settings was not called despite a forced tool_choice');
    }
    return validateRiskScoredProposal(proposal.input, research.citations);
  })();

  return withWallClock(work, timeoutMs);
}
