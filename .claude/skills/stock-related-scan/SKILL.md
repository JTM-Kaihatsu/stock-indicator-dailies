---
name: stock-related-scan
description: Run stock-indicator-dailies reads across a primary ticker and a set of related tickers the user names (peers, complementary industries), and summarize where they agree or diverge. Use when the user asks to compare a ticker against others, or check related/complementary stocks.
---

# Related-ticker scan

This skill needs a list of tickers from the user — it does not maintain its own sector/peer map. If they named a primary ticker but no related ones, ask which peers or complementary names they want checked (e.g. "which related tickers should I include — sector peers, suppliers, competitors you have in mind?") rather than guessing a list yourself.

Once you have the full list (primary ticker + related ones, dedup'd), call `analyze_ticker` (server `stock-indicator-dailies`) once per ticker, one at a time, in the order given — the server serializes captures internally, so calls will naturally queue, but issue them sequentially from your side too rather than firing them all at once. Each call takes roughly 5-20 seconds; for a long list, tell the user up front roughly how long this will take (~10s × ticker count) before starting.

If any individual ticker fails, don't abort the whole scan — note the failure for that ticker (stage + reason) and continue with the rest.

## Presenting results

A table: ticker → deterministic signal → AI signal → whether they agree. Then a short summary:

- Which tickers agree with the primary ticker's signal, and which diverge.
- Any indicator that's driving a divergence worth calling out (e.g. "AMD is also SELL on MACD but HOLD overall, unlike NVDA which is unanimous").

This is a comparison of what the indicators currently show across the set, not a recommendation about which one to prefer — leave that framing out.
