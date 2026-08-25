---
name: stock-read
description: Capture and interpret a ticker's current daily chart signal using the stock-indicator-dailies MCP server. Use when the user asks for a read, signal, or analysis on a specific stock ticker.
---

# Stock read

Use the `analyze_ticker` MCP tool (server `stock-indicator-dailies`) with the ticker the user named, upper-cased.

The tool call drives a real browser capture and a real model call — it takes roughly 5-20 seconds and is not free. Call it once per ticker per request; don't retry speculatively.

## On success (`ok: true`)

Present, in this order:

1. **Overall signal** — state both reads plainly: the deterministic (computed-from-price-data) signal and the AI/chart-read signal. If they disagree, say so explicitly; don't paper over it.
2. **Per-indicator detail** — for each of `macd`, `slowStochastic`, `sma`: crossover direction, how many bars ago, whether it was "qualified," from both `report.deterministic.readings` and `report.verdict.readings`. Note any indicator where the two disagree.
3. **Rationale** — `report.verdict.rationale` if present, in your own words, not a verbatim dump.
4. **Caveats** — any `report.warnings`, and if `report.timings.withinTarget` is false, mention the read took longer than the normal target.

Do not present this as investment advice — it's a report of what the indicators show, not a recommendation.

## On failure (`ok: false`)

State plainly which stage failed (`capture` vs `analysis`) and the `reason`. If `userMessage` is present (e.g. a provider outage), lead with that. Don't retry automatically — ask the user whether they want you to try again.

## Chaining

If the user's request also mentions a position they hold (or are considering), or asks "should I do anything about this," don't just stop at the read — continue into the `stock-position-review` skill using the report you already have (no need to call `analyze_ticker` again). Otherwise, mention briefly that you can review this against a position if they have one.
