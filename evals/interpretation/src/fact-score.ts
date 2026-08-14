import {
  deriveIndicatorSignal,
  type DeriveSignalOptions,
  type IndicatorKey,
  type IndicatorReading,
  type IndicatorSignal,
} from '@stock-indicator-dailies/shared';

/**
 * Compares the two independent reads for one chart; the VLM's, and the
 * `fetched` read computed from price data; WITHOUT treating either as ground
 * truth. Both are displayed to the user (and to the FE); the human labels the
 * real answer afterwards. So this reports *agreement* between the two reads
 * (direction, barsAgo gap, qualified), not accuracy against a reference.
 *
 * The barsAgo gap is the field worth watching: on GEV the two agreed on
 * direction (bearish) but differed by 3 bars, which straddled the recency
 * window. Signal-level agreement alone would hide that.
 */
export interface FactComparison {
  ticker?: string;
  indicator: IndicatorKey;
  vlm: IndicatorReading;
  fetched: IndicatorReading;
  /** Crossover directions equal (BULLISH/BEARISH/NONE all count). */
  directionMatch: boolean;
  vlmSignal: IndicatorSignal;
  fetchedSignal: IndicatorSignal;
  /** Derived per-indicator signals equal, after the recency/qualified gates. */
  signalMatch: boolean;
  /** Both sides reported a non-NONE crossover, so barsAgo/qualified are comparable. */
  bothCrossed: boolean;
  /** |vlm.barsAgo − fetched.barsAgo|. Present only when `bothCrossed`. */
  barsAgoGap?: number;
  /** `qualified` flags equal. Present only when `bothCrossed`. */
  qualifiedMatch?: boolean;
}

const noneReading = (indicator: IndicatorKey): IndicatorReading => ({
  indicator,
  crossover: 'NONE',
  qualified: false,
});

/**
 * Compare one chart's VLM readings against the fetched readings, one entry per
 * indicator the fetched read covers. A VLM indicator that is missing is treated
 * as a NONE reading (a disagreement, not an omission).
 */
export function compareReadings(
  vlmReadings: readonly IndicatorReading[],
  fetchedReadings: readonly IndicatorReading[],
  options: DeriveSignalOptions = {},
  ticker?: string,
): FactComparison[] {
  const vlmByKey = new Map(vlmReadings.map((r) => [r.indicator, r]));

  return fetchedReadings.map((fetched) => {
    const vlm = vlmByKey.get(fetched.indicator) ?? noneReading(fetched.indicator);
    const vlmSignal = deriveIndicatorSignal(vlm, options);
    const fetchedSignal = deriveIndicatorSignal(fetched, options);
    const bothCrossed = vlm.crossover !== 'NONE' && fetched.crossover !== 'NONE';

    const comparison: FactComparison = {
      ...(ticker ? { ticker } : {}),
      indicator: fetched.indicator,
      vlm,
      fetched,
      directionMatch: vlm.crossover === fetched.crossover,
      vlmSignal,
      fetchedSignal,
      signalMatch: vlmSignal === fetchedSignal,
      bothCrossed,
    };
    if (bothCrossed) {
      comparison.barsAgoGap = Math.abs((vlm.barsAgo ?? 0) - (fetched.barsAgo ?? 0));
      comparison.qualifiedMatch = vlm.qualified === fetched.qualified;
    }
    return comparison;
  });
}

/** Aggregate stats for the barsAgo gap, over the comparisons where both crossed. */
export interface BarsAgoStats {
  /** How many comparisons contributed (both sides crossed). */
  n: number;
  /** Mean absolute gap, in bars. 0 when `n` is 0. */
  mean: number;
  /** Median absolute gap, in bars. 0 when `n` is 0. */
  median: number;
  /** Largest single gap, in bars. 0 when `n` is 0. */
  max: number;
}

export interface AgreementRates {
  comparisons: number;
  directionAgreement: number;
  signalAgreement: number;
  /** Comparisons where both sides reported a crossover (barsAgo denominator). */
  bothCrossed: number;
  /** `qualified` agreement over `bothCrossed`. 1 when nothing qualified-comparable. */
  qualifiedAgreement: number;
  barsAgo: BarsAgoStats;
}

export interface AgreementSummary extends AgreementRates {
  perIndicator: Record<IndicatorKey, AgreementRates>;
}

function barsAgoStats(gaps: readonly number[]): BarsAgoStats {
  if (gaps.length === 0) return { n: 0, mean: 0, median: 0, max: 0 };
  const sorted = [...gaps].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
  return {
    n: gaps.length,
    mean: gaps.reduce((s, g) => s + g, 0) / gaps.length,
    median,
    max: sorted.at(-1)!,
  };
}

function rates(comparisons: readonly FactComparison[]): AgreementRates {
  const total = comparisons.length;
  const both = comparisons.filter((c) => c.bothCrossed);
  const gaps = both.map((c) => c.barsAgoGap!).filter((g) => g !== undefined);
  const qualified = both.filter((c) => c.qualifiedMatch).length;

  return {
    comparisons: total,
    directionAgreement:
      total === 0 ? 1 : comparisons.filter((c) => c.directionMatch).length / total,
    signalAgreement: total === 0 ? 1 : comparisons.filter((c) => c.signalMatch).length / total,
    bothCrossed: both.length,
    qualifiedAgreement: both.length === 0 ? 1 : qualified / both.length,
    barsAgo: barsAgoStats(gaps),
  };
}

/** Roll a flat list of comparisons up into overall + per-indicator agreement rates. */
export function summarize(comparisons: readonly FactComparison[]): AgreementSummary {
  const keys: IndicatorKey[] = ['macd', 'slowStochastic', 'sma'];
  const perIndicator = Object.fromEntries(
    keys.map((k) => [k, rates(comparisons.filter((c) => c.indicator === k))]),
  ) as Record<IndicatorKey, AgreementRates>;

  return { ...rates(comparisons), perIndicator };
}
