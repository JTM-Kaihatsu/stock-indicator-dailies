/** The three technical indicators Stock Indicator Dailies evaluates on every chart. */
export type IndicatorKey = 'macd' | 'slowStochastic' | 'sma';

/**
 * A single indicator's derived directional signal, after the recency/zone rules
 * are applied to the reading. `NEUTRAL` means no active signal.
 */
export type IndicatorSignal = 'BUY' | 'SELL' | 'NEUTRAL';

/** The overall recommendation surfaced to the user on the Daily Report card. */
export type Signal = 'BUY' | 'SELL' | 'HOLD';

/**
 * Direction of the most recent *clean* crossover for an indicator, as judged by
 * the VLM. `NONE` covers both "no crossover" and "too choppy to call one" — the
 * VLM is expected to not force a crossover out of noise.
 *
 * The crossover per indicator:
 * - MACD: the MACD line crossing its signal line.
 * - Slow Stochastic: %K crossing %D.
 * - SMA: price crossing the 10-day SMA.
 */
export type CrossoverDirection = 'BULLISH' | 'BEARISH' | 'NONE';

/**
 * The VLM's interpreted *facts* for one indicator — what it read off the chart,
 * before any recency judgment. The signal is derived from these downstream
 * (see `deriveIndicatorSignal`), keeping the tunable rules out of the model.
 */
export interface IndicatorReading {
  indicator: IndicatorKey;
  /** Direction of the most recent clean crossover, or NONE. */
  crossover: CrossoverDirection;
  /** Daily bars since that crossover. Present iff `crossover !== 'NONE'`. */
  barsAgo?: number;
  /**
   * Whether the crossover met its zone/slope condition — MACD below zero
   * (bullish) / above zero (bearish); Stochastic oversold / overbought; SMA
   * upward / downward slope. Ignored when `crossover` is NONE.
   */
  qualified: boolean;
  /**
   * Free-text justification the VLM produced, shown to the user so they can
   * verify the call against the source screenshot (human-in-the-loop).
   */
  rationale?: string;
}

/**
 * A captured chart screenshot. Produced by the agent, consumed by the VLM —
 * hence it lives here rather than in either package.
 *
 * Capture is expected to be scoped to the chart region only (never a full-page
 * screenshot), so account chrome never enters the image. See the image
 * sanitization requirement in the PRD.
 */
export interface ChartImage {
  /** Base64-encoded image bytes (no `data:` prefix). */
  base64: string;
  /** MIME type, e.g. `image/png`. */
  mediaType: string;
}

/** The full structured verdict produced for one captured chart. */
export interface Verdict {
  /** Uppercased exchange ticker, e.g. "NVDA". */
  ticker: string;
  /** Overall recommendation derived from {@link IndicatorReading}s. */
  signal: Signal;
  /** Per-indicator readings; normally one entry per {@link IndicatorKey}. */
  readings: IndicatorReading[];
  /** Optional overall rationale summarizing the readings. */
  rationale?: string;
  /**
   * The date range the model actually saw on the chart's axis, as it reported it
   * (e.g. `"Jan 2026 to Aug 2026"`).
   *
   * Observability only — the axis is canvas-rendered, so this is the one way to
   * learn what history the model was given. Treat as a soft signal: it is the
   * model's reading, not a measurement.
   */
  visibleRange?: string;
  /** ISO-8601 timestamp of when the underlying chart was captured. */
  capturedAt?: string;
}
