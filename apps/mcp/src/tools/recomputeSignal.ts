import { recomputeReport, type DeriveSignalOptions } from '@stock-indicator-dailies/shared';
import type { DailyReport } from '@stock-indicator-dailies/daily';

/** Rederives the overall signal from a previously-captured report's
 * readings at different sensitivity thresholds. Pure, no new capture. */
export function recomputeSignal(report: DailyReport, options: DeriveSignalOptions): DailyReport {
  return recomputeReport(report, options);
}
