import Anthropic from '@anthropic-ai/sdk';

import type { VlmProvider, VlmRequest } from '../provider.ts';

/** Default model — Sonnet 5: high-res vision + strong structured output. */
export const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-5';
/**
 * Ceiling, not a target — you're billed on actual output. Must comfortably fit
 * both the adaptive-thinking budget (on by default for Sonnet 5) AND the JSON
 * verdict; 1024 truncated the JSON once thinking + three fuller rationales grew.
 */
export const DEFAULT_MAX_TOKENS = 4096;
/**
 * Effort caps how deep adaptive thinking (and overall token spend) goes. Sonnet 5
 * defaults to `high`, which ran its adaptive thinking nearly unbounded and pushed
 * time-to-signal to ~30s in the first eval. `budget_tokens` is rejected on Sonnet
 * 5 (400) — effort is the supported lever. We keep thinking ON (an independent
 * read still benefits from some reasoning) but bound it. `low` is the default; the
 * eval measures the accuracy cost against the calibrated fetched read.
 */
export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export const DEFAULT_EFFORT: EffortLevel = 'low';

/**
 * The slice of the Anthropic SDK this provider depends on. Declaring it as an
 * interface lets tests inject a fake client — no network, no API key, not flaky.
 */
export interface AnthropicLike {
  messages: {
    create(body: AnthropicCreateBody): Promise<AnthropicResponse>;
  };
}

interface AnthropicCreateBody {
  model: string;
  max_tokens: number;
  system?: string;
  messages: Array<{ role: 'user'; content: AnthropicRequestBlock[] }>;
  /** Adaptive thinking, kept on but bounded by `output_config.effort`. */
  thinking?: { type: 'adaptive' | 'disabled' };
  output_config?: { effort: EffortLevel };
}

type AnthropicRequestBlock =
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'text'; text: string };

interface AnthropicResponse {
  content: Array<{ type: string; text?: string }>;
  stop_reason?: string | null;
}

export interface ClaudeVlmProviderOptions {
  /** Defaults to `process.env.VLM_API_KEY`. */
  apiKey?: string;
  /** Defaults to {@link DEFAULT_CLAUDE_MODEL}. */
  model?: string;
  /** Defaults to {@link DEFAULT_MAX_TOKENS}. */
  maxTokens?: number;
  /** Adaptive-thinking / spend cap. Defaults to {@link DEFAULT_EFFORT} (`low`). */
  effort?: EffortLevel;
  /**
   * Whether adaptive thinking runs at all. Defaults to `adaptive` — we cap it
   * with `effort` rather than turning it off, since a chart read still benefits
   * from some reasoning and disabling thinking on Sonnet 5 has known failure
   * modes (reasoning leaking into the response text).
   */
  thinking?: 'adaptive' | 'disabled';
  /** Inject a client (or fake) instead of constructing a real SDK instance. */
  client?: AnthropicLike;
}

/**
 * {@link VlmProvider} backed by the Anthropic API. Sends the chart image plus
 * the assembled prompt to Claude and returns the model's raw text, which the
 * caller pipes through `interpretChartResponse` / `parseVerdict`.
 */
export class ClaudeVlmProvider implements VlmProvider {
  readonly name = 'claude';
  readonly #client: AnthropicLike;
  readonly #model: string;
  readonly #maxTokens: number;
  readonly #effort: EffortLevel;
  readonly #thinking: 'adaptive' | 'disabled';

  constructor(options: ClaudeVlmProviderOptions = {}) {
    this.#model = options.model ?? DEFAULT_CLAUDE_MODEL;
    this.#maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.#effort = options.effort ?? DEFAULT_EFFORT;
    this.#thinking = options.thinking ?? 'adaptive';
    this.#client =
      options.client ??
      (new Anthropic({ apiKey: options.apiKey ?? process.env.VLM_API_KEY }) as unknown as AnthropicLike);
  }

  async complete(request: VlmRequest): Promise<string> {
    const response = await this.#client.messages.create({
      model: this.#model,
      max_tokens: this.#maxTokens,
      thinking: { type: this.#thinking },
      output_config: { effort: this.#effort },
      system: request.systemPrompt,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: request.image.mediaType,
                data: request.image.base64,
              },
            },
            { type: 'text', text: request.userInstruction },
          ],
        },
      ],
    });

    if (response.stop_reason === 'max_tokens') {
      throw new Error(
        `Claude response was truncated (stop_reason=max_tokens) at maxTokens=${this.#maxTokens} — ` +
          `raise maxTokens. Thinking tokens share this budget.`,
      );
    }

    return response.content
      .filter((block): block is { type: 'text'; text: string } =>
        block.type === 'text' && typeof block.text === 'string',
      )
      .map((block) => block.text)
      .join('');
  }
}
