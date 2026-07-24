import type { ExpectedStudy } from './profiles/tradingview.ts';

/**
 * Structural validation of the captured chart: confirm every required study is
 * actually on the chart with the expected parameters *before* the image goes to
 * the VLM. This is the PRD's "DOM volatility" mitigation — if the saved layout
 * changed or failed to load, we fail loudly instead of inferring from a chart
 * that is missing an indicator.
 */

/** Legend text arrives with whitespace and live values; normalize for matching. */
export function normalizeLegend(text: string): string {
  return text.replace(/\s+/g, '');
}

export interface StudyValidation {
  ok: boolean;
  /** Labels of studies that were expected but not found. */
  missing: string[];
  /** Labels of studies that matched. */
  found: string[];
}

/**
 * Check the chart's legend strings against the expected studies. A study counts
 * as present when any legend entry matches its pattern.
 */
export function validateStudies(
  legendTexts: readonly string[],
  expected: readonly ExpectedStudy[],
): StudyValidation {
  const normalized = legendTexts.map(normalizeLegend);
  const found: string[] = [];
  const missing: string[] = [];

  for (const study of expected) {
    if (normalized.some((text) => study.legendPattern.test(text))) {
      found.push(study.label);
    } else {
      missing.push(study.label);
    }
  }

  return { ok: missing.length === 0, missing, found };
}
