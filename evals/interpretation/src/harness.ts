import { writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  SUCCESS_TARGETS,
  type ChartImage,
  type IndicatorReading,
  type ParseVerdictOptions,
} from '@stock-indicator-dailies/shared';
import { ChartAcquisitionError, type ChartAgent } from '@stock-indicator-dailies/agent';
import { analyzeChart, type VlmProvider } from '@stock-indicator-dailies/vlm';
import { computeReadings, yahooDataSource, type DataSource } from '@stock-indicator-dailies/indicators';

import { compareReadings, summarize, type AgreementSummary, type FactComparison } from './fact-score.ts';

/**
 * The batch interpretation harness.
 *
 * For each ticker it runs the real pipeline; capture the chart, run the VLM,
 * and compute the `fetched` read from price data; then records both reads and
 * their agreement with {@link compareReadings}. Neither read is treated as
 * ground truth: the run exports both so the user can label the real answer by
 * hand. Every dependency is injected, so the whole thing runs offline in tests
 * with the fake agent + a stub provider; the live CLI (`run-eval.ts`) wires the
 * real, billed implementations.
 *
 * Charts are processed sequentially: the real agent drives one browser, and the
 * provider call is billed, so there is nothing to gain from concurrency and much
 * to lose (rate limits, interleaved browser state).
 */
export interface EvalDeps {
  agent: ChartAgent;
  provider: VlmProvider;
  /** OHLC source for the oracle. Defaults to Yahoo Finance. */
  dataSource?: DataSource;
}

export interface EvalOptions extends ParseVerdictOptions {
  /** Injectable clock so timing is deterministic in tests. */
  now?: () => number;
  /** OHLC history to request. Default `1y`. */
  range?: string;
  /**
   * When set, the captured chart PNG is written to `<imageDir>/<TICKER>.png`;
   * the evidence image for hand-labeling. The directory must already exist.
   */
  imageDir?: string;
}

/** One chart's outcome; both reads plus their agreement, or the stage that failed. */
export interface ChartEvalResult {
  ticker: string;
  ok: boolean;
  /** Stage + message when `ok` is false. */
  error?: string;
  comparisons?: FactComparison[];
  /** Where the evidence PNG was written, if `imageDir` was set. */
  imagePath?: string;
  /** The VLM's read (the AI second opinion). */
  vlm?: IndicatorReading[];
  /** The read computed from fetched price data. */
  fetched?: IndicatorReading[];
  /** What the model said it saw on the axis; observability only. */
  visibleRange?: string;
  captureMs: number;
  analyzeMs: number;
  /** capture + analyze; the PRD's time-to-signal metric. */
  totalMs: number;
  withinTarget: boolean;
}

export interface EvalTiming {
  medianTotalMs: number;
  maxTotalMs: number;
  /** How many successful charts met the time-to-signal target. */
  withinTarget: number;
}

export interface EvalRun {
  results: ChartEvalResult[];
  /** VLM-vs-fetched agreement over the charts that completed (not accuracy). */
  summary: AgreementSummary;
  timing: EvalTiming;
}

/** Write a chart PNG to `<dir>/<name>.png`; returns the path, or undefined on error. */
function saveImage(dir: string, name: string, image: ChartImage): string | undefined {
  const out = path.join(dir, `${name}.png`);
  try {
    writeFileSync(out, Buffer.from(image.base64, 'base64'));
    return out;
  } catch {
    return undefined;
  }
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/** Grade one chart end to end. Failures are captured, never thrown. */
async function evalOne(
  ticker: string,
  deps: EvalDeps,
  options: EvalOptions,
): Promise<ChartEvalResult> {
  const now = options.now ?? Date.now;
  const dataSource = deps.dataSource ?? yahooDataSource;
  const range = options.range ?? '1y';
  const fail = (
    stage: string,
    message: string,
    captureMs: number,
    analyzeMs: number,
    imagePath?: string,
  ): ChartEvalResult => ({
    ticker,
    ok: false,
    error: `${stage}: ${message}`,
    ...(imagePath ? { imagePath } : {}),
    captureMs,
    analyzeMs,
    totalMs: captureMs + analyzeMs,
    withinTarget: false,
  });

  // --- Capture ---
  const captureStart = now();
  let image;
  try {
    image = await deps.agent.acquire(ticker);
  } catch (err) {
    const captureMs = now() - captureStart;
    const reason = err instanceof ChartAcquisitionError ? err.reason : 'unknown';
    // A rejected chart (blank studies, wrong interval) often still carries the
    // image it was rejected on; save it so the failure can be eyeballed.
    const diagnostic =
      err instanceof ChartAcquisitionError && err.image && options.imageDir
        ? saveImage(options.imageDir, `${ticker}.FAILED`, err.image)
        : undefined;
    return fail(
      'capture',
      `${reason}; ${err instanceof Error ? err.message : String(err)}`,
      captureMs,
      0,
      diagnostic,
    );
  }
  const captureMs = now() - captureStart;

  // Persist the evidence image (element-scoped, no account PII) for hand-labeling.
  const imagePath = options.imageDir ? saveImage(options.imageDir, ticker, image) : undefined;

  // --- Analyze (the billed model call) ---
  const analyzeStart = now();
  let result: Awaited<ReturnType<typeof analyzeChart>>;
  try {
    result = await analyzeChart({ ticker, image, provider: deps.provider }, options);
  } catch (err) {
    return fail('analysis', err instanceof Error ? err.message : String(err), captureMs, now() - analyzeStart, imagePath);
  }
  const analyzeMs = now() - analyzeStart;
  if (!result.ok) {
    return fail('analysis', result.errors.join('; '), captureMs, analyzeMs, imagePath);
  }

  // --- Fetched read (computed from price data; a cross-check, not truth) ---
  let fetched: IndicatorReading[];
  try {
    const { bars } = await dataSource.fetchDailyBars(ticker, range);
    fetched = computeReadings(bars);
  } catch (err) {
    return fail('fetch', err instanceof Error ? err.message : String(err), captureMs, analyzeMs, imagePath);
  }

  const vlm = result.verdict.readings;
  const totalMs = captureMs + analyzeMs;
  return {
    ticker,
    ok: true,
    comparisons: compareReadings(vlm, fetched, options, ticker),
    ...(imagePath ? { imagePath } : {}),
    vlm,
    fetched,
    ...(result.verdict.visibleRange ? { visibleRange: result.verdict.visibleRange } : {}),
    captureMs,
    analyzeMs,
    totalMs,
    withinTarget: totalMs <= SUCCESS_TARGETS.timeToSignalMs,
  };
}

/** Run the harness over a list of tickers, sequentially. */
export async function runEval(
  tickers: readonly string[],
  deps: EvalDeps,
  options: EvalOptions = {},
): Promise<EvalRun> {
  const results: ChartEvalResult[] = [];
  for (const ticker of tickers) {
    results.push(await evalOne(ticker.toUpperCase(), deps, options));
  }

  const ok = results.filter((r) => r.ok);
  const comparisons = ok.flatMap((r) => r.comparisons ?? []);
  const totals = ok.map((r) => r.totalMs);

  return {
    results,
    summary: summarize(comparisons),
    timing: {
      medianTotalMs: median(totals),
      maxTotalMs: totals.length === 0 ? 0 : Math.max(...totals),
      withinTarget: ok.filter((r) => r.withinTarget).length,
    },
  };
}
