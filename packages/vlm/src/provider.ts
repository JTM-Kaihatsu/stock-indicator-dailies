/** A chart screenshot to send to the model. */
export interface ChartImage {
  /** Base64-encoded image bytes (no `data:` prefix). */
  base64: string;
  /** MIME type, e.g. `image/png`. */
  mediaType: string;
}

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
