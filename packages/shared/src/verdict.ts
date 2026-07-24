import { INDICATOR_KEYS } from './indicators.ts';
import { deriveSignal, type DeriveSignalOptions } from './signal.ts';
import type {
  IndicatorKey,
  IndicatorReading,
  IndicatorSignal,
  Verdict,
} from './types.ts';

/** Valid per-indicator reading values. */
const INDICATOR_SIGNALS: readonly IndicatorSignal[] = ['BUY', 'SELL', 'NEUTRAL'];
/** Valid overall signal values (what the VLM might echo back). */
const OVERALL_SIGNALS: readonly string[] = ['BUY', 'SELL', 'HOLD'];
/** Permissive exchange-ticker shape: leading letter, then letters/digits/`.`/`-`. */
const TICKER_RE = /^[A-Z][A-Z0-9.-]{0,9}$/;

export interface ParseVerdictOptions extends DeriveSignalOptions {
  /**
   * Require a reading for every indicator in {@link INDICATOR_KEYS}. Default true —
   * a partial chart read is treated as invalid rather than silently under-counted.
   */
  requireAllIndicators?: boolean;
}

export type VerdictParseResult =
  | { ok: true; verdict: Verdict; warnings: string[] }
  | { ok: false; errors: string[] };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validate raw VLM output and produce a trustworthy {@link Verdict}.
 *
 * The overall `signal` is always recomputed from the per-indicator readings via
 * {@link deriveSignal} — the deterministic logic is authoritative, not the model.
 * If the model also returned an overall signal, it's cross-checked: a disagreement
 * (or an invalid value) is surfaced as a warning, not an error, and the derived
 * signal is used regardless. Structural problems (bad shape, unknown indicator,
 * invalid enum, missing/duplicate indicators, malformed ticker/timestamp) fail.
 */
export function parseVerdict(
  input: unknown,
  options: ParseVerdictOptions = {},
): VerdictParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const requireAll = options.requireAllIndicators ?? true;

  if (!isObject(input)) {
    return { ok: false, errors: ['verdict must be a JSON object'] };
  }

  // --- ticker ---
  let ticker = '';
  if (typeof input.ticker !== 'string' || input.ticker.trim() === '') {
    errors.push('ticker must be a non-empty string');
  } else {
    ticker = input.ticker.trim().toUpperCase();
    if (!TICKER_RE.test(ticker)) {
      errors.push(`ticker "${ticker}" is not a valid symbol`);
    }
  }

  // --- readings ---
  const readings: IndicatorReading[] = [];
  if (!Array.isArray(input.readings)) {
    errors.push('readings must be an array');
  } else {
    const seen = new Set<string>();
    input.readings.forEach((raw, i) => {
      if (!isObject(raw)) {
        errors.push(`readings[${i}] must be an object`);
        return;
      }
      const { indicator, signal, rationale } = raw;

      const indicatorOk =
        typeof indicator === 'string' && INDICATOR_KEYS.includes(indicator as IndicatorKey);
      const isDuplicate = indicatorOk && seen.has(indicator as string);

      if (!indicatorOk) {
        errors.push(`readings[${i}].indicator "${String(indicator)}" is not a known indicator`);
      } else if (isDuplicate) {
        errors.push(`duplicate reading for indicator "${String(indicator)}"`);
      } else {
        seen.add(indicator as string);
      }

      const signalOk = typeof signal === 'string' && INDICATOR_SIGNALS.includes(signal as IndicatorSignal);
      if (!signalOk) {
        errors.push(`readings[${i}].signal "${String(signal)}" must be BUY, SELL, or NEUTRAL`);
      }

      if (rationale !== undefined && typeof rationale !== 'string') {
        errors.push(`readings[${i}].rationale must be a string when present`);
      }

      if (indicatorOk && !isDuplicate && signalOk) {
        readings.push({
          indicator: indicator as IndicatorKey,
          signal: signal as IndicatorSignal,
          ...(typeof rationale === 'string' ? { rationale } : {}),
        });
      }
    });

    if (requireAll) {
      for (const key of INDICATOR_KEYS) {
        if (!seen.has(key)) errors.push(`missing reading for indicator "${key}"`);
      }
    }
  }

  // --- optional rationale ---
  let rationale: string | undefined;
  if (input.rationale !== undefined) {
    if (typeof input.rationale !== 'string') {
      errors.push('rationale must be a string when present');
    } else {
      rationale = input.rationale;
    }
  }

  // --- optional visibleRange (model's reading of the date axis) ---
  let visibleRange: string | undefined;
  if (input.visibleRange !== undefined) {
    if (typeof input.visibleRange !== 'string') {
      errors.push('visibleRange must be a string when present');
    } else {
      visibleRange = input.visibleRange;
    }
  }

  // --- optional capturedAt ---
  let capturedAt: string | undefined;
  if (input.capturedAt !== undefined) {
    if (typeof input.capturedAt !== 'string' || Number.isNaN(Date.parse(input.capturedAt))) {
      errors.push('capturedAt must be an ISO-8601 date string when present');
    } else {
      capturedAt = input.capturedAt;
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // Authoritative overall signal — deterministic, from the readings.
  const signal = deriveSignal(readings, options);

  // Cross-check the model's self-reported signal, if it provided one.
  if (input.signal !== undefined) {
    if (typeof input.signal !== 'string' || !OVERALL_SIGNALS.includes(input.signal)) {
      warnings.push(`ignoring invalid model signal "${String(input.signal)}"`);
    } else if (input.signal !== signal) {
      warnings.push(
        `model signal "${input.signal}" disagreed with derived "${signal}"; using derived`,
      );
    }
  }

  const verdict: Verdict = {
    ticker,
    signal,
    readings,
    ...(rationale !== undefined ? { rationale } : {}),
    ...(visibleRange !== undefined ? { visibleRange } : {}),
    ...(capturedAt !== undefined ? { capturedAt } : {}),
  };
  return { ok: true, verdict, warnings };
}
