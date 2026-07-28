import type { CrossoverDirection } from '@stock-indicator-dailies/shared';

/**
 * The most recent crossover of series `a` over series `b`, found by scanning
 * back from the right edge for the latest sign change of `(a − b)`.
 *
 *   a crosses ABOVE b  (diff goes ≤0 → >0)  → BULLISH
 *   a crosses BELOW b  (diff goes ≥0 → <0)  → BEARISH
 *
 * `atIndex` is the bar where the cross completed; `barsAgo` is measured from the
 * last usable bar. Returns NONE when no sign change is present in the data.
 */
export interface CrossoverResult {
  direction: CrossoverDirection;
  /** Bar index where the crossover completed, or -1 for NONE. */
  atIndex: number;
  /** Bars since the crossover, from the last defined bar, or undefined for NONE. */
  barsAgo?: number;
}

/** Index of the last bar where both series are defined (not NaN). */
function lastDefinedIndex(a: readonly number[], b: readonly number[]): number {
  for (let i = a.length - 1; i >= 0; i--) {
    if (!Number.isNaN(a[i]!) && !Number.isNaN(b[i]!)) return i;
  }
  return -1;
}

export function detectCrossover(a: readonly number[], b: readonly number[]): CrossoverResult {
  const last = lastDefinedIndex(a, b);
  if (last <= 0) return { direction: 'NONE', atIndex: -1 };

  for (let i = last; i > 0; i--) {
    const prev = a[i - 1]! - b[i - 1]!;
    const curr = a[i]! - b[i]!;
    if (Number.isNaN(prev) || Number.isNaN(curr)) continue;
    // A completed cross: strictly one side before, strictly the other after.
    if (prev <= 0 && curr > 0) return { direction: 'BULLISH', atIndex: i, barsAgo: last - i };
    if (prev >= 0 && curr < 0) return { direction: 'BEARISH', atIndex: i, barsAgo: last - i };
  }
  return { direction: 'NONE', atIndex: -1 };
}
