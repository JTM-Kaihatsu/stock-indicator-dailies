import Anthropic from '@anthropic-ai/sdk';

import { PROPOSE_SETTINGS_TOOL, WEB_SEARCH_TOOL, validateProposedSettings, type ProposedSettings } from './tool.ts';

export const DEFAULT_MODEL = 'claude-sonnet-5';
export const DEFAULT_MAX_TOKENS = 4096;
/** Round-trip safety net, not the primary bound; see DEFAULT_SEARCH_BUDGET. */
export const DEFAULT_MAX_TURNS = 4;
/**
 * Total searches allowed across the *whole* conversation, not per call.
 * `max_uses` on the tool itself only caps a single `messages.create`
 * response; since web_search is a server tool, one turn can already chain
 * several searches, and this loop can run multiple turns, so without a
 * cumulative budget the true worst case is `maxTurns * per-call max_uses`.
 * Once this hits zero, web_search is dropped from the offered tools
 * entirely and propose_settings is forced immediately, regardless of
 * remaining turns.
 */
export const DEFAULT_SEARCH_BUDGET = 5;
/** Wall-clock cap on the whole call; protects against the model simply
 * being slow (or a hung request) even while within its search budget. */
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

export interface AdvisorResult {
  rationale: string;
  settings: ProposedSettings;
}

export class AdvisorTimeoutError extends Error {
  constructor(maxTurns: number) {
    super(`advisor did not call propose_settings within ${maxTurns} turns`);
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

const SYSTEM_PROMPT = `You are researching a public company to help tune a technical-analysis trading tool's
indicator settings for its stock.

Use web_search to research the company: its industry and sector, current trends affecting it,
recent relevant news, and its competitors. Base your proposal on what you find; do not rely on
general knowledge alone when search results are available. Your search budget is limited, so
prioritize the highest-value queries rather than searching exhaustively.

You MUST end by calling propose_settings exactly once, as your final action. Do not give your
answer as plain text.`;

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

interface RunLoopOptions {
  client: AnthropicLike;
  model: string;
  maxTokens: number;
  maxTurns: number;
  searchBudget: number;
}

async function runLoop(ticker: string, options: RunLoopOptions): Promise<AdvisorResult> {
  const { client, model, maxTokens, maxTurns, searchBudget } = options;
  const messages: Array<{ role: 'user' | 'assistant'; content: unknown }> = [
    { role: 'user', content: `Research ${ticker} and propose indicator settings for it.` },
  ];

  let searchesUsed = 0;

  for (let turn = 0; turn < maxTurns; turn++) {
    const remainingSearches = Math.max(0, searchBudget - searchesUsed);
    const budgetExhausted = remainingSearches === 0;
    const forcing = turn === maxTurns - 1 || budgetExhausted;

    const tools = budgetExhausted
      ? [PROPOSE_SETTINGS_TOOL]
      : [{ ...WEB_SEARCH_TOOL, max_uses: remainingSearches }, PROPOSE_SETTINGS_TOOL];

    let response: Awaited<ReturnType<AnthropicLike['messages']['create']>>;
    try {
      response = await client.messages.create({
        model,
        max_tokens: maxTokens,
        system: SYSTEM_PROMPT,
        tools,
        tool_choice: forcing ? { type: 'tool', name: 'propose_settings' } : { type: 'auto' },
        messages,
      });
    } catch (err) {
      const status = extractStatus(err);
      if (status !== undefined && RETRYABLE_STATUSES.has(status)) {
        throw new AdvisorUpstreamError(status, friendlyUpstreamMessage(status));
      }
      throw err;
    }

    searchesUsed += countSearchesUsed(response.content);

    const proposal = findToolUse(response.content, 'propose_settings');
    if (proposal) {
      return validateProposedSettings(proposal.input);
    }

    // Not done yet; carry the assistant's turn forward (including any
    // server_tool_use / web_search_tool_result blocks) and nudge it to
    // wrap up on the next attempt.
    messages.push({ role: 'assistant', content: response.content });
    messages.push({
      role: 'user',
      content: forcing
        ? 'Call propose_settings now with your best proposal based on the research so far.'
        : 'Continue your research if needed, then call propose_settings.',
    });
  }

  throw new AdvisorTimeoutError(maxTurns);
}

/** Researches `ticker`'s company via Claude + the hosted web_search tool and
 * returns a structured settings proposal with a rationale. Throws
 * AdvisorTimeoutError if the model never calls propose_settings within
 * maxTurns, or AdvisorWallClockTimeoutError if the whole call runs past
 * timeoutMs. */
export async function researchAndPropose(ticker: string, options: AdvisorOptions = {}): Promise<AdvisorResult> {
  const model = options.model ?? DEFAULT_MODEL;
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  const maxTurns = options.maxTurns ?? DEFAULT_MAX_TURNS;
  const searchBudget = options.searchBudget ?? DEFAULT_SEARCH_BUDGET;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const client: AnthropicLike =
    options.client ??
    (new Anthropic({
      apiKey: options.apiKey ?? process.env.VLM_API_KEY,
      maxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES,
    }) as unknown as AnthropicLike);

  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AdvisorWallClockTimeoutError(timeoutMs)), timeoutMs);
  });

  try {
    return await Promise.race([
      runLoop(ticker, { client, model, maxTokens, maxTurns, searchBudget }),
      timeout,
    ]);
  } finally {
    clearTimeout(timer!);
  }
}
