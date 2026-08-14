import { deriveSignal } from '@stock-indicator-dailies/shared';
import type { DailyReport } from '@/types/api';
import { toLiveOptions, type LiveSettings } from './settings.ts';

/**
 * Recomputes `deterministic.signal` and `verdict.signal` from their
 * already-loaded `readings` arrays, using the live-scoped 3 levers. Pure —
 * no network call, since `deriveSignal` only needs facts already present on
 * the report. Leaves `readings`, `image`, `warnings`, and `timings` untouched.
 */
export function recomputeReport(report: DailyReport, settings: LiveSettings): DailyReport {
  const options = toLiveOptions(settings);
  return {
    ...report,
    deterministic: report.deterministic
      ? { ...report.deterministic, signal: deriveSignal(report.deterministic.readings, options) }
      : report.deterministic,
    verdict: { ...report.verdict, signal: deriveSignal(report.verdict.readings, options) },
  };
}
