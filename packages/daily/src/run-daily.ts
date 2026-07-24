import {
  SUCCESS_TARGETS,
  type ChartImage,
  type ParseVerdictOptions,
  type Verdict,
} from '@stock-indicator-dailies/shared';
import { ChartAcquisitionError, type ChartAgent } from '@stock-indicator-dailies/agent';
import { analyzeChart, type VlmProvider } from '@stock-indicator-dailies/vlm';

/** Where a run failed, so callers can react appropriately. */
export type DailyStage = 'capture' | 'analysis';

export interface DailyTimings {
  captureMs: number;
  analyzeMs: number;
  totalMs: number;
  /** Whether the run met the PRD's time-to-signal target. */
  withinTarget: boolean;
}

export interface DailyReport {
  ticker: string;
  verdict: Verdict;
  /** Non-fatal notes, e.g. the model's own signal disagreeing with ours. */
  warnings: string[];
  timings: DailyTimings;
  /**
   * The chart the verdict was derived from. Surfaced so the user can verify the
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
    };

export interface RunDailyInput {
  ticker: string;
  agent: ChartAgent;
  provider: VlmProvider;
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

  const timings = (captureMs: number, analyzeMs: number): DailyTimings => {
    const totalMs = captureMs + analyzeMs;
    return {
      captureMs,
      analyzeMs,
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
  const result = await analyzeChart({ ticker, image, provider: input.provider }, options);
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

  return {
    ok: true,
    report: {
      ticker,
      verdict: result.verdict,
      warnings: result.warnings,
      timings: timings(captureMs, analyzeMs),
      image,
      raw: result.raw,
    },
  };
}
