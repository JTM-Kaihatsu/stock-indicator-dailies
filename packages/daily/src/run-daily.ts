import {
  deriveSignal,
  SUCCESS_TARGETS,
  type ChartImage,
  type IndicatorReading,
  type ParseVerdictOptions,
  type Signal,
  type Verdict,
} from '@stock-indicator-dailies/shared';
import { ChartAcquisitionError, type ChartAgent } from '@stock-indicator-dailies/agent';
import { analyzeChart, type VlmProvider } from '@stock-indicator-dailies/vlm';
import {
  computeLastBar,
  computeReadings,
  yahooDataSource,
  type DataSource,
  type IndicatorValues,
} from '@stock-indicator-dailies/indicators';

/**
 * The deterministic read — computed from price data, the accurate signal source.
 * Shown alongside the VLM read as a cross-check, and the headline of the report.
 */
export interface DeterministicRead {
  readings: IndicatorReading[];
  signal: Signal;
  /** Last-bar indicator values, for the report's hover details. */
  values: IndicatorValues;
  /** Where the OHLC came from, e.g. `yahoo`. */
  source: string;
  /** Date of the last bar used. */
  asOf: string;
  bars: number;
}

/** Where a run failed, so callers can react appropriately. */
export type DailyStage = 'capture' | 'analysis';

export interface DailyTimings {
  captureMs: number;
  analyzeMs: number;
  /** Time spent fetching + computing the deterministic read (network). */
  deterministicMs: number;
  /** Capture + analyze, the PRD's time-to-signal metric. */
  totalMs: number;
  /** Whether capture + analyze met the PRD's time-to-signal target. */
  withinTarget: boolean;
}

export interface DailyReport {
  ticker: string;
  /** The VLM's read — the AI second opinion / cross-check. */
  verdict: Verdict;
  /** The computed read from price data — the accurate, headline signal. Absent if the data fetch failed. */
  deterministic?: DeterministicRead;
  /** Non-fatal notes, e.g. VLM/derived disagreement, or the data fetch failing. */
  warnings: string[];
  timings: DailyTimings;
  /**
   * The chart the reads were derived from. Surfaced so the user can verify the
   * call against the source image — the PRD's human-in-the-loop requirement.
   */
  image: ChartImage;
  /** Raw model output, retained for debugging and eval. */
  raw: string;
}

export type DailyResult =
  | { ok: true; report: DailyReport }
  | {
      ok: false;
      stage: DailyStage;
      /** `ChartAcquisitionFailure` for capture, or `invalid-verdict` for analysis. */
      reason: string;
      errors: string[];
      timings: DailyTimings;
      /**
       * The chart at the moment of failure, when the capture agent could still
       * grab one (e.g. studies didn't render, wrong interval) — so a failure log
       * can show *what was on screen*, not just the error string.
       */
      image?: ChartImage;
    };

export interface RunDailyInput {
  ticker: string;
  agent: ChartAgent;
  provider: VlmProvider;
  /** OHLC source for the deterministic read. Defaults to Yahoo Finance. */
  dataSource?: DataSource;
}

export interface RunDailyOptions extends ParseVerdictOptions {
  /** Injectable clock so timing assertions are deterministic in tests. */
  now?: () => number;
}

/**
 * One "Daily": capture the chart, interpret it, and return a verdict.
 *
 * Failures are returned rather than thrown, and tagged with the stage that
 * failed — a capture failure (expired session, missing study, wrong interval)
 * needs a different response than the model returning unparseable output.
 */
export async function runDaily(
  input: RunDailyInput,
  options: RunDailyOptions = {},
): Promise<DailyResult> {
  const now = options.now ?? Date.now;
  const ticker = input.ticker.toUpperCase();
  const started = now();

  const timings = (captureMs: number, analyzeMs: number, deterministicMs = 0): DailyTimings => {
    const totalMs = captureMs + analyzeMs;
    return {
      captureMs,
      analyzeMs,
      deterministicMs,
      totalMs,
      withinTarget: totalMs <= SUCCESS_TARGETS.timeToSignalMs,
    };
  };

  // --- 1. Capture ---
  let image: ChartImage;
  try {
    image = await input.agent.acquire(ticker);
  } catch (err) {
    const captureMs = now() - started;
    if (err instanceof ChartAcquisitionError) {
      return {
        ok: false,
        stage: 'capture',
        reason: err.reason,
        errors: [err.message],
        timings: timings(captureMs, 0),
        ...(err.image ? { image: err.image } : {}),
      };
    }
    return {
      ok: false,
      stage: 'capture',
      reason: 'unknown',
      errors: [err instanceof Error ? err.message : String(err)],
      timings: timings(captureMs, 0),
    };
  }
  const captureMs = now() - started;

  // --- 2. Analyze ---
  const analyzeStarted = now();
  let result: Awaited<ReturnType<typeof analyzeChart>>;
  try {
    result = await analyzeChart({ ticker, image, provider: input.provider }, options);
  } catch (err) {
    // A thrown provider error (network, truncation, auth) — surface it cleanly.
    return {
      ok: false,
      stage: 'analysis',
      reason: 'provider-error',
      errors: [err instanceof Error ? err.message : String(err)],
      timings: timings(captureMs, now() - analyzeStarted),
    };
  }
  const analyzeMs = now() - analyzeStarted;

  if (!result.ok) {
    return {
      ok: false,
      stage: 'analysis',
      reason: 'invalid-verdict',
      errors: result.errors,
      timings: timings(captureMs, analyzeMs),
    };
  }

  const warnings = [...result.warnings];

  // --- 3. Deterministic read (best-effort — a data-fetch failure is non-fatal) ---
  const detStarted = now();
  let deterministic: DeterministicRead | undefined;
  try {
    const source = input.dataSource ?? yahooDataSource;
    const bars = await source.fetchDailyBars(ticker, '1y');
    const readings = computeReadings(bars);
    deterministic = {
      readings,
      signal: deriveSignal(readings, options),
      values: computeLastBar(bars),
      source: source.name,
      asOf: bars.at(-1)?.date ?? 'unknown',
      bars: bars.length,
    };
  } catch (err) {
    warnings.push(
      `deterministic read unavailable: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const deterministicMs = now() - detStarted;

  return {
    ok: true,
    report: {
      ticker,
      verdict: result.verdict,
      ...(deterministic ? { deterministic } : {}),
      warnings,
      timings: timings(captureMs, analyzeMs, deterministicMs),
      image,
      raw: result.raw,
    },
  };
}
