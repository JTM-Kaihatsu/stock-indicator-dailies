/** Plain-English label for a DailyResult failure's `stage`, so the user
 * knows WHERE in the pipeline it broke, not just that it broke. Falls back
 * to the raw stage string for any value not in this list, so a future new
 * stage still shows something rather than nothing. */
const STAGE_LABELS: Record<string, string> = {
  capture: 'retrieving the chart from TradingView',
  analysis: "Claude interpreting the chart",
};

export function stageLabel(stage: string): string {
  return STAGE_LABELS[stage] ?? stage;
}

/** Builds the message shown for a failed DailyResult: prefer the friendly
 * `userMessage` when the backend supplied one (e.g. an outage), otherwise a
 * stage-labeled fallback so at least *where* it failed is clear. */
export function dailyFailureMessage(result: { stage: string; reason: string; userMessage?: string }): string {
  if (result.userMessage) return result.userMessage;
  return `Failed while ${stageLabel(result.stage)}: ${result.reason}`;
}
