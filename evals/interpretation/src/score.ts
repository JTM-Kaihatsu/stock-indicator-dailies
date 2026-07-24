import type { IndicatorKey, IndicatorReading } from '@stock-indicator-dailies/shared';

/** One indicator's expected-vs-actual mismatch. */
export interface Disagreement {
  ticker?: string;
  indicator: IndicatorKey;
  expected: string;
  got: string;
}

export interface Scorecard {
  /** Per-indicator comparisons made. */
  total: number;
  correct: number;
  /** correct / total, or 1 when nothing was compared. */
  accuracy: number;
  perIndicator: Record<IndicatorKey, { correct: number; total: number }>;
  disagreements: Disagreement[];
}

function emptyPerIndicator(): Scorecard['perIndicator'] {
  return {
    macd: { correct: 0, total: 0 },
    slowStochastic: { correct: 0, total: 0 },
    sma: { correct: 0, total: 0 },
  };
}

function index(readings: readonly IndicatorReading[]): Map<IndicatorKey, string> {
  return new Map(readings.map((r) => [r.indicator, r.signal]));
}

/**
 * Grade one chart's predicted readings against the oracle. Only indicators the
 * oracle has a truth value for are scored; a prediction missing an indicator the
 * oracle covers counts as a miss (`got: "(missing)"`).
 */
export function scoreChart(
  predicted: readonly IndicatorReading[],
  truth: readonly IndicatorReading[],
  ticker?: string,
): Scorecard {
  const pred = index(predicted);
  const perIndicator = emptyPerIndicator();
  const disagreements: Disagreement[] = [];
  let correct = 0;
  let total = 0;

  for (const t of truth) {
    total++;
    perIndicator[t.indicator].total++;
    const got = pred.get(t.indicator) ?? '(missing)';
    if (got === t.signal) {
      correct++;
      perIndicator[t.indicator].correct++;
    } else {
      disagreements.push({ ...(ticker ? { ticker } : {}), indicator: t.indicator, expected: t.signal, got });
    }
  }

  return { total, correct, accuracy: total === 0 ? 1 : correct / total, perIndicator, disagreements };
}

/** Combine per-chart scorecards into one aggregate. */
export function aggregate(cards: readonly Scorecard[]): Scorecard {
  const perIndicator = emptyPerIndicator();
  const disagreements: Disagreement[] = [];
  let correct = 0;
  let total = 0;

  for (const card of cards) {
    correct += card.correct;
    total += card.total;
    disagreements.push(...card.disagreements);
    for (const key of Object.keys(perIndicator) as IndicatorKey[]) {
      perIndicator[key].correct += card.perIndicator[key].correct;
      perIndicator[key].total += card.perIndicator[key].total;
    }
  }

  return { total, correct, accuracy: total === 0 ? 1 : correct / total, perIndicator, disagreements };
}
