import type { ChartImage } from '@stock-indicator-dailies/shared';

/** Re-exported for convenience so VLM consumers don't need a second import. */
export type { ChartImage };

/** Everything a provider needs to run one chart analysis. */
export interface VlmRequest {
  systemPrompt: string;
  userInstruction: string;
  image: ChartImage;
}

/**
 * A provider-agnostic multimodal model (Gemini/GPT-class). Concrete
 * implementations wrap a specific SDK; tests and callers depend only on this.
 */
export interface VlmProvider {
  /** Human-readable provider name, e.g. `gemini`. */
  readonly name: string;
  /** Return the model's raw text output, expected to contain the JSON verdict. */
  complete(request: VlmRequest): Promise<string>;
}
