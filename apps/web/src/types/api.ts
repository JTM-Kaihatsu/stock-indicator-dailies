import type {
  IndicatorReading,
  Signal,
  Verdict,
  ChartImage,
} from '@stock-indicator-dailies/shared';

export interface IndicatorValues {
  macd: { macd: number; signal: number; histogram: number };
  stochastic: { percentK: number; percentD: number };
  sma: number;
  close: number;
}

export interface DeterministicRead {
  readings: IndicatorReading[];
  signal: Signal;
  values: IndicatorValues;
  source: string;
  asOf: string;
  bars: number;
}

export interface DailyTimings {
  captureMs: number;
  analyzeMs: number;
  deterministicMs: number;
  totalMs: number;
  withinTarget: boolean;
}

export interface DailyReport {
  ticker: string;
  verdict: Verdict;
  deterministic?: DeterministicRead;
  warnings: string[];
  timings: DailyTimings;
  image: ChartImage;
  raw: string;
}

export type DailyResult =
  | { ok: true; report: DailyReport }
  | { ok: false; stage: string; reason: string; errors: string[]; timings: DailyTimings };

/** Response from POST /api/daily/start; a cache hit resolves inline, a
 * miss returns a job id to poll instead. */
export type StartResponse =
  | { ok: true; report: DailyReport }
  | { ok: true; jobId: string }
  | { ok: false; reason: string };

/** Response from GET /api/daily/jobs/:id. */
export type JobStatusResponse =
  | { status: 'pending' }
  | { status: 'done'; result: DailyResult }
  | { status: 'not-found' };
