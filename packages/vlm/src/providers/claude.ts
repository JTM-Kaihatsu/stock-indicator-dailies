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

  constructor(options: ClaudeVlmProviderOptions = {}) {
    this.#model = options.model ?? DEFAULT_CLAUDE_MODEL;
    this.#maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.#client =
      options.client ??
      (new Anthropic({ apiKey: options.apiKey ?? process.env.VLM_API_KEY }) as unknown as AnthropicLike);
  }

  async complete(request: VlmRequest): Promise<string> {
    const response = await this.#client.messages.create({
      model: this.#model,
      max_tokens: this.#maxTokens,
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
