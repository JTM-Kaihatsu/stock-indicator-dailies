/** Shared ticker validation/normalization; was duplicated (slightly
 * differently each time) across daily.ts, backtest.ts, and advisor.ts.
 * Trims, uppercases, and validates against the same pattern everywhere so a
 * ticker accepted by one endpoint is never silently rejected by another. */
const TICKER_PATTERN = /^[A-Z]{1,5}(\.[A-Z]{1,2})?$/;

export function parseTicker(raw?: string): string | null {
  const t = raw?.trim().toUpperCase();
  if (!t || !TICKER_PATTERN.test(t)) return null;
  return t;
}
