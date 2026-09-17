import Anthropic from '@anthropic-ai/sdk';

import {
  PROPOSE_SETTINGS_TOOL,
  SUBMIT_RESEARCH_TOOL,
  WEB_SEARCH_TOOL,
  validateResearchProposal,
  validateRiskScoredProposal,
  type ResearchProposal,
  type RiskScoredProposal,
  type RiskTolerance,
} from './tool.ts';

export const DEFAULT_MODEL = 'claude-sonnet-5';
export const DEFAULT_MAX_TOKENS = 4096;
/** Round-trip safety net, not the primary bound; see DEFAULT_SEARCH_BUDGET.
 * Only meaningful for researchCompany; scoreForRiskTolerance is a single
 * forced-tool call with no search loop, so turns don't apply to it. */
export const DEFAULT_MAX_TURNS = 4;
/**
 * Total searches allowed across the *whole* research call, not per turn.
 * `max_uses` on the tool itself only caps a single `messages.create`
 * response; since web_search is a server tool, one turn can already chain
 * several searches, and the research loop can run multiple turns, so
 * without a cumulative budget the true worst case is `maxTurns *
 * per-call max_uses`. Once this hits zero, web_search is dropped from the
 * offered tools entirely and submit_research is forced immediately,
 * regardless of remaining turns.
 */
export const DEFAULT_SEARCH_BUDGET = 5;
/** Wall-clock cap on one call; protects against the model simply being
 * slow (or a hung request) even while within its search budget. */
export const DEFAULT_TIMEOUT_MS = 60_000;
/** This is a background job, not a synchronous request on the critical
 * path, so it can afford to absorb more of Anthropic's transient
 * 429/5xx/529 responses than the SDK's own default of 2 before giving up.
 * The SDK already applies exponential backoff between attempts. */
export const DEFAULT_MAX_RETRIES = 5;

/** The slice of the SDK this depends on; narrow and injectable, same
 * testability pattern as packages/vlm/src/providers/claude.ts. */
export interface AnthropicLike {
  messages: {
    create(body: Record<string, unknown>): Promise<{
      content: Array<{ type: string; [key: string]: unknown }>;
      stop_reason?: string | null;
    }>;
  };
}

export interface AdvisorOptions {
  /** Defaults to `process.env.VLM_API_KEY`; same key already used for the
   * chart-reading VLM calls, since both are Claude API usage. */
  apiKey?: string;
  model?: string;
  maxTokens?: number;
  maxTurns?: number;
  searchBudget?: number;
  timeoutMs?: number;
  /** Only applies when `client` is not supplied; ignored for an injected
   * test client, which has no retry behavior of its own. */
  maxRetries?: number;
  client?: AnthropicLike;
}

/** researchCompany's own options never need maxTurns/searchBudget tuned
 * independently of the module defaults in practice, but kept symmetric
 * with AdvisorOptions for consistency and testability. */
export type ResearchOptions = AdvisorOptions;

/** scoreForRiskTolerance is a single forced-tool call; maxTurns and
 * searchBudget don't apply to it (no loop, no web_search offered). */
export type ScoreOptions = Omit<AdvisorOptions, 'maxTurns' | 'searchBudget'>;

export class AdvisorTimeoutError extends Error {
  constructor(maxTurns: number) {
    super(`advisor did not call submit_research within ${maxTurns} turns`);
    this.name = 'AdvisorTimeoutError';
  }
}

export class AdvisorWallClockTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`advisor did not finish within ${timeoutMs}ms`);
    this.name = 'AdvisorWallClockTimeoutError';
  }
}

/** Anthropic's API returned a transient error (rate limit, overload, or a
 * 5xx) after the SDK's own retries were exhausted. Distinct from
 * AdvisorTimeoutError (the model never proposed) and
 * AdvisorWallClockTimeoutError (the whole call ran too long); this one
 * means the upstream API itself was unavailable, and trying again shortly
 * is likely to work. */
export class AdvisorUpstreamError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'AdvisorUpstreamError';
    this.status = status;
  }
}

const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504, 529]);

/** Duck-typed status extraction so this works against both the real
 * Anthropic SDK's APIError and any fake client tests throw. */
function extractStatus(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null || !('status' in err)) return undefined;
  const status = (err as { status?: unknown }).status;
  return typeof status === 'number' ? status : undefined;
}

function friendlyUpstreamMessage(status: number): string {
  if (status === 529) {
    return "Claude's API is temporarily overloaded. This usually clears up within a minute; please try again shortly.";
  }
  if (status === 429) {
    return "Hit Claude's API rate limit. Please wait a moment and try again.";
  }
  return `Claude's API returned an unexpected error (HTTP ${status}). Please try again shortly.`;
}

/** Wraps a Claude call so both stages translate a transient upstream error
 * (rate limit, overload, 5xx) into AdvisorUpstreamError the same way,
 * instead of letting the SDK's raw error escape. */
async function createMessage(
  client: AnthropicLike,
  body: Record<string, unknown>,
): Promise<Awaited<ReturnType<AnthropicLike['messages']['create']>>> {
  try {
    return await client.messages.create(body);
  } catch (err) {
    const status = extractStatus(err);
    if (status !== undefined && RETRYABLE_STATUSES.has(status)) {
      throw new AdvisorUpstreamError(status, friendlyUpstreamMessage(status));
    }
    throw err;
  }
}

function buildClient(options: { apiKey?: string; maxRetries?: number; client?: AnthropicLike }): AnthropicLike {
  return (
    options.client ??
    (new Anthropic({
      apiKey: options.apiKey ?? process.env.VLM_API_KEY,
      maxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES,
    }) as unknown as AnthropicLike)
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

/** Counts how many web_search invocations actually happened in a response;
 * `server_tool_use` blocks are the model's search calls; unlike a
 * client-defined tool, Anthropic resolves these server-side inline in the
 * same response, so there's no separate round-trip to count. */
function countSearchesUsed(content: Array<{ type: string; [key: string]: unknown }>): number {
  return content.filter((block) => block.type === 'server_tool_use' && block.name === 'web_search').length;
}

const RESEARCH_SYSTEM_PROMPT = `You are researching a public company to build a reusable research brief for a
technical-analysis trading tool. This brief will be used later, in a separate step you are not doing here, to
tune indicator settings for different investor risk tolerances and to judge whether the stock suits each one;
write it to stand on its own, not slanted toward any one risk profile.

Use web_search to research the company: its industry and sector, current trends affecting it, recent relevant
news, its competitors, and how volatile or speculative its stock currently is. Base your findings on what you
find; do not rely on general knowledge alone when search results are available. Your search budget is limited,
so prioritize the highest-value queries rather than searching exhaustively.

You MUST end by calling submit_research exactly once, as your final action. Do not give your answer as plain
text.`;

interface ResearchLoopOptions {
  client: AnthropicLike;
  model: string;
  maxTokens: number;
  maxTurns: number;
  searchBudget: number;
}

async function researchLoop(ticker: string, options: ResearchLoopOptions): Promise<ResearchProposal> {
  const { client, model, maxTokens, maxTurns, searchBudget } = options;
  const messages: Array<{ role: 'user' | 'assistant'; content: unknown }> = [
    { role: 'user', content: `Research ${ticker} and submit your findings.` },
  ];

  let searchesUsed = 0;

  for (let turn = 0; turn < maxTurns; turn++) {
    const remainingSearches = Math.max(0, searchBudget - searchesUsed);
    const budgetExhausted = remainingSearches === 0;
    const forcing = turn === maxTurns - 1 || budgetExhausted;

    const tools = budgetExhausted
      ? [SUBMIT_RESEARCH_TOOL]
      : [{ ...WEB_SEARCH_TOOL, max_uses: remainingSearches }, SUBMIT_RESEARCH_TOOL];

    const response = await createMessage(client, {
      model,
      max_tokens: maxTokens,
      // Fixed, byte-for-byte identical on every call (no ticker-specific
      // content); a cache breakpoint here lets a call within the TTL of a
      // prior one (any ticker) skip re-processing it.
      system: [{ type: 'text', text: RESEARCH_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      tools,
      tool_choice: forcing ? { type: 'tool', name: 'submit_research' } : { type: 'auto' },
      messages,
    });

    searchesUsed += countSearchesUsed(response.content);

    const proposal = findToolUse(response.content, 'submit_research');
    if (proposal) {
      return validateResearchProposal(proposal.input);
    }

    // Not done yet; carry the assistant's turn forward (including any
    // server_tool_use / web_search_tool_result blocks) and nudge it to
    // wrap up on the next attempt.
    messages.push({ role: 'assistant', content: response.content });
    messages.push({
      role: 'user',
      content: forcing
        ? 'Call submit_research now with your best findings so far.'
        : 'Continue your research if needed, then call submit_research.',
    });
  }

  throw new AdvisorTimeoutError(maxTurns);
}

/** Researches `ticker`'s company via Claude + the hosted web_search tool and
 * returns a reusable research brief. Throws AdvisorTimeoutError if the
 * model never calls submit_research within maxTurns, or
 * AdvisorWallClockTimeoutError if the whole call runs past timeoutMs. This
 * is stage 1 of 2 (see scoreForRiskTolerance for stage 2); split out so the
 * expensive, web-search-backed part is cacheable per ticker regardless of
 * which risk tolerance ends up being scored against it. */
export async function researchCompany(ticker: string, options: ResearchOptions = {}): Promise<ResearchProposal> {
  const model = options.model ?? DEFAULT_MODEL;
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  const maxTurns = options.maxTurns ?? DEFAULT_MAX_TURNS;
  const searchBudget = options.searchBudget ?? DEFAULT_SEARCH_BUDGET;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const client = buildClient(options);

  return withWallClock(researchLoop(ticker, { client, model, maxTokens, maxTurns, searchBudget }), timeoutMs);
}

const SCORE_SYSTEM_PROMPT = `You are tuning a technical-analysis trading tool's indicator settings for one
stock, for an investor with a specific, stated risk tolerance. You are given a research brief gathered
separately in an earlier step; no search tool is available here, so work only from what you're given.

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

You MUST end by calling propose_settings exactly once, as your final action, with a rationale, the settings,
and the fit verdict + its reason. Do not give your answer as plain text.`;

const RISK_TOLERANCE_LABELS: Record<RiskTolerance, string> = {
  averse: 'risk-averse',
  neutral: 'risk-neutral',
  seeking: 'risk-seeking',
};

/** Scores an already-researched company against one investor risk
 * tolerance: proposes tuned settings and judges whether the stock itself
 * suits that stance. Stage 2 of 2 (see researchCompany); a single forced
 * tool call, no web_search, no turn loop; meant to be cheap and fast
 * enough to re-run per risk tolerance without re-researching. */
export async function scoreForRiskTolerance(
  ticker: string,
  research: string,
  riskTolerance: RiskTolerance,
  options: ScoreOptions = {},
): Promise<RiskScoredProposal> {
  const model = options.model ?? DEFAULT_MODEL;
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const client = buildClient(options);

  const work = (async () => {
    const response = await createMessage(client, {
      model,
      max_tokens: maxTokens,
      system: [{ type: 'text', text: SCORE_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      tools: [PROPOSE_SETTINGS_TOOL],
      tool_choice: { type: 'tool', name: 'propose_settings' },
      messages: [
        {
          role: 'user',
          content:
            `Research on ${ticker}:\n${research}\n\n` +
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
    return validateRiskScoredProposal(proposal.input);
  })();

  return withWallClock(work, timeoutMs);
}
