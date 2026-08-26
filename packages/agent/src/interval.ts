/**
 * Bar-interval verification.
 *
 * The indicator spec is defined on DAILY bars (a 10-day SMA, MACD 8/17/9 on
 * daily closes). If the chart silently loads an intraday interval, every study
 * is computed over the wrong timeframe and the resulting verdict is confidently
 * wrong; the failure is invisible in the image unless you read the header.
 *
 * TradingView renders the symbol header as name + interval + exchange, which
 * normalizes to e.g. `GGE Vernova Inc.1DNYSE` or `NNVIDIA Corporation1DNASDAQ`.
 */

/** Matches the interval token immediately preceding the exchange code. */
const HEADER_INTERVAL = /(\d+[mhDWM]|[DWM])([A-Z]{2,6})$/;

/**
 * Extract the chart's current interval token (e.g. `1D`, `1h`, `30m`) from the
 * page's text nodes. Returns null when no symbol header is recognizable.
 *
 * Only the real symbol header carries an interval, and it always contains the
 * lowercase-bearing company name (`…Platforms,Inc.1DNASDAQ`). We require a
 * lowercase letter to skip the all-caps decoys that also fit `<token><CODE>`:
 * the bare ticker `META` (→ `M`+`ETA`), `NASDAQ` (→ `D`+`AQ`), the `MACD`
 * legend, and so on. Without this, `META` matched first in DOM order and made
 * a correctly-daily chart look like it was on monthly bars.
 */
export function extractIntervalToken(texts: readonly string[]): string | null {
  for (const raw of texts) {
    const text = raw.replace(/\s+/g, '');
    if (text.length > 80) continue;
    if (!/[a-z]/.test(text)) continue;
    const match = HEADER_INTERVAL.exec(text);
    if (match?.[1]) return match[1];
  }
  return null;
}

/** True when the chart is on the expected interval. */
export function isExpectedInterval(
  texts: readonly string[],
  expected: string,
): boolean {
  return extractIntervalToken(texts) === expected;
}
