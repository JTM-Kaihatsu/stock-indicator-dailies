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
  /** Labels of studies whose name/params were not found at all. */
  missing: string[];
  /**
   * Labels of studies whose name matched but whose plotted values had not
   * rendered — the legend name is a *prefix* match, so a blank, unrendered pane
   * still matches the name. Only reported when a `values` map is supplied.
   */
  notRendered: string[];
  /** Labels of studies that matched and (if checked) had rendered values. */
  found: string[];
}

/**
 * Check the chart's legend against the expected studies.
 *
 * A study is "found" only when its name/params pattern matches AND — when a
 * `values` map (legend title → live number) is supplied — every one of its
 * {@link ExpectedStudy.valueTitles} has actually rendered a finite value. The
 * name check alone is a prefix match, so it passes even when the plots are still
 * blank; the value check is what proves the study actually painted.
 */
export function validateStudies(
  legendTexts: readonly string[],
  expected: readonly ExpectedStudy[],
  values?: Record<string, number>,
): StudyValidation {
  const normalized = legendTexts.map(normalizeLegend);
  const found: string[] = [];
  const missing: string[] = [];
  const notRendered: string[] = [];

  for (const study of expected) {
    if (!normalized.some((text) => study.legendPattern.test(text))) {
      missing.push(study.label);
      continue;
    }
    if (values && study.valueTitles && study.valueTitles.length > 0) {
      const rendered = study.valueTitles.every((title) => Number.isFinite(values[title]));
      if (!rendered) {
        notRendered.push(study.label);
        continue;
      }
    }
    found.push(study.label);
  }

  return {
    ok: missing.length === 0 && notRendered.length === 0,
    missing,
    notRendered,
    found,
  };
}
