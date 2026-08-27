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

/**
 * Recognized exchange codes the header can end in. Anchoring to an exact,
 * whole exchange name (rather than a loose `[A-Z]{2,6}`) is what makes the
 * match unambiguous — see HEADER_INTERVAL below.
 */
const KNOWN_EXCHANGES = ['NASDAQ', 'NYSE', 'AMEX', 'ARCA', 'BATS', 'CBOE', 'OTC'] as const;

/**
 * Matches the interval token immediately preceding a *whole* known exchange
 * code at the end of the string.
 *
 * A looser `[A-Z]{2,6}$` for the exchange half used to cause two real false
 * positives, both observed live (e.g. capturing AMZN or MSFT):
 *  1. The ticker symbol itself is often present elsewhere on the page (nav
 *     bar, search, watchlist) as a short all-caps string, and can *itself*
 *     satisfy the old pattern — "AMZN" backtracks to "M" + "ZN", "MSFT" to
 *     "M" + "SFT" — neither of which is a real exchange code, so anchoring
 *     to the known list rejects both outright.
 *  2. A duplicate header text node without the interval infix at all (just
 *     name + exchange, e.g. "...Inc.NASDAQ") would backtrack into splitting
 *     the exchange word itself — "NASDAQ" -> "D" + "AQ" ("AQ" isn't a real
 *     exchange either) — misreading a letter *inside* "NASDAQ" as the
 *     interval. Requiring the full, exact exchange name closes that off:
 *     there's no valid split left once "AQ"/"SDAQ"/etc. are no longer
 *     acceptable matches for the exchange group.
 * `extractIntervalToken` still stops at the first text that matches, so this
 * only works because it's now precise enough that an unrelated page string
 * can no longer look like a valid header by accident.
 */
const HEADER_INTERVAL = new RegExp(`(\\d+[mhDWM]|[DWM])(${KNOWN_EXCHANGES.join('|')})$`);

/**
 * Extract the chart's current interval token (e.g. `1D`, `1h`, `30m`) from the
 * page's text nodes. Returns null when no symbol header is recognizable.
 */
export function extractIntervalToken(texts: readonly string[]): string | null {
  for (const raw of texts) {
    const text = raw.replace(/\s+/g, '');
    if (text.length > 80) continue;
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
