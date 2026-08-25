---
name: stock-sensitivity-whatif
description: Show how a stock-indicator-dailies signal would change under different sensitivity thresholds (BUY/SELL consensus, recency window). Use when the user asks "what if," how sensitive a read is, or wants to see the signal under looser/stricter settings.
---

# Sensitivity what-if

Get a report for the ticker first: reuse one already in the conversation (e.g. from `stock-read`) if present, otherwise call `analyze_ticker` (server `stock-indicator-dailies`).

Then call `recompute_signal` (same server) once per preset below, passing the report object unchanged each time — this is pure and instant, no new capture per call:

1. **Default** — no overrides (or explicitly `buyConsensus: 2, sellConsensus: 3, recencyDays: 3`, the app's own defaults) — this is the baseline to compare everything else against.
2. **Looser consensus** — `buyConsensus: 1, sellConsensus: 1` — a single qualified indicator is enough to move off HOLD.
3. **Stricter consensus** — `buyConsensus: 3, sellConsensus: 3` — requires unanimity on both sides.
4. **Shorter recency** — `recencyDays: 1` — only a crossover from the most recent bar counts.

If the user specifies their own thresholds instead of asking generically, use those instead of (or in addition to) the presets above.

## Presenting results

Build a small table: preset → deterministic signal → AI/verdict signal. Call out plainly where the signal flips versus the default, and which specific indicator readings are driving that flip (barsAgo values close to a recency cutoff, or a signal count sitting right at a consensus threshold). If nothing flips across all four presets, say the read is robust to sensitivity, not just show the unchanged table.

Don't editorialize about which preset is "right" — this is descriptive information about how sensitive the current read is, not a recommendation to run the app at different settings.
