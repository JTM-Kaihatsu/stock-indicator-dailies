import Anthropic from '@anthropic-ai/sdk';

import { PROPOSE_SETTINGS_TOOL, WEB_SEARCH_TOOL, validateProposedSettings, type ProposedSettings } from './tool.ts';

export const DEFAULT_MODEL = 'claude-sonnet-5';
export const DEFAULT_MAX_TOKENS = 4096;
/** Safety net, not the primary path — `web_search` is a server tool, so
 * Claude can chain multiple searches and reasoning steps within a single
 * response. This bounds how many follow-up turns we'll allow if the model
 * stops without having called propose_settings yet. */
export const DEFAULT_MAX_TURNS = 4;

/** The slice of the SDK this depends on — narrow and injectable, same
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
  /** Defaults to `process.env.VLM_API_KEY` — same key already used for the
   * chart-reading VLM calls, since both are Claude API usage. */
  apiKey?: string;
  model?: string;
  maxTokens?: number;
  maxTurns?: number;
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

const SYSTEM_PROMPT = `You are researching a public company to help tune a technical-analysis trading tool's
indicator settings for its stock.

Use web_search to research the company: its industry and sector, current trends affecting it,
recent relevant news, and its competitors. Base your proposal on what you find — do not rely on
general knowledge alone when search results are available.

You MUST end by calling propose_settings exactly once, as your final action. Do not give your
answer as plain text.`;

function findToolUse(content: Array<{ type: string; [key: string]: unknown }>, name: string) {
  return content.find((block) => block.type === 'tool_use' && block.name === name) as
    | { type: 'tool_use'; id: string; name: string; input: unknown }
    | undefined;
}

/** Researches `ticker`'s company via Claude + the hosted web_search tool and
 * returns a structured settings proposal with a rationale. Throws
 * AdvisorTimeoutError if the model never calls propose_settings within
 * maxTurns. */
export async function researchAndPropose(ticker: string, options: AdvisorOptions = {}): Promise<AdvisorResult> {
  const model = options.model ?? DEFAULT_MODEL;
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  const maxTurns = options.maxTurns ?? DEFAULT_MAX_TURNS;
  const client: AnthropicLike =
    options.client ??
    (new Anthropic({ apiKey: options.apiKey ?? process.env.VLM_API_KEY }) as unknown as AnthropicLike);

  const messages: Array<{ role: 'user' | 'assistant'; content: unknown }> = [
    { role: 'user', content: `Research ${ticker} and propose indicator settings for it.` },
  ];

  for (let turn = 0; turn < maxTurns; turn++) {
    const forcing = turn === maxTurns - 1;
    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system: SYSTEM_PROMPT,
      tools: [WEB_SEARCH_TOOL, PROPOSE_SETTINGS_TOOL],
      tool_choice: forcing ? { type: 'tool', name: 'propose_settings' } : { type: 'auto' },
      messages,
    });

    const proposal = findToolUse(response.content, 'propose_settings');
    if (proposal) {
      return validateProposedSettings(proposal.input);
    }

    // Not done yet — carry the assistant's turn forward (including any
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
