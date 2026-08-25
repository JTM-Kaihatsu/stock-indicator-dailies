import { deriveSignal, type DeriveSignalOptions } from './signal.ts';
import type { IndicatorReading, Signal } from './types.ts';

interface ReadPart {
  readings: readonly IndicatorReading[];
  signal: Signal;
}

/**
 * Recomputes `deterministic.signal` and `verdict.signal` from their
 * already-loaded `readings` arrays. Pure; no network call, since
 * `deriveSignal` only needs facts already present on the report. Leaves
 * `readings`, and every other field, untouched.
 *
 * Generic over `T` (rather than importing a concrete `DailyReport` type) so
 * both the web app's locally-duplicated report type and the daily package's
 * own `DailyReport` can share this one implementation without a dependency
 * pointing the wrong way across the package graph.
 */
export function recomputeReport<T extends { verdict: ReadPart; deterministic?: ReadPart }>(
  report: T,
  options: DeriveSignalOptions,
): T {
  return {
    ...report,
    deterministic: report.deterministic
      ? { ...report.deterministic, signal: deriveSignal(report.deterministic.readings, options) }
      : report.deterministic,
    verdict: { ...report.verdict, signal: deriveSignal(report.verdict.readings, options) },
  };
}
