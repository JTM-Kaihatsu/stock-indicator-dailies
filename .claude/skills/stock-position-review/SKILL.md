---
name: stock-position-review
description: Frame a stock-indicator-dailies signal read against a position the user says they hold, are considering entering, or are considering exiting. Use when the user mentions their own holding alongside a ticker (shares, cost basis, "should I do anything about X").
---

# Stock position review

This skill takes a ticker plus whatever the user tells you about their position **in the same message** — nothing is looked up or remembered. If they didn't state a position, ask once ("do you currently hold this, and if so roughly how much / at what basis? Or are you considering entering or exiting?") rather than assuming.

## Getting the read

If a report for this ticker already exists earlier in the conversation (e.g. from `stock-read`), reuse it — don't call `analyze_ticker` again. Otherwise call `analyze_ticker` (server `stock-indicator-dailies`) for the ticker first.

## Framing — descriptive, not prescriptive

State how the current signal relates to what the user told you, and stop there:

- **Holds a position, signal is SELL** → "the signal is SELL, and you said you're holding N shares at $X" — note the direction relative to their stated cost basis (up/down since entry) if they gave one, but do not say how many shares to sell or when.
- **Holds a position, signal is BUY or HOLD** → note the signal doesn't suggest reducing the position; don't suggest adding a specific amount either.
- **No position, considering entering, signal is BUY** → note the signal supports the idea of entering; don't suggest a share count, price target, or entry timing.
- **No position, considering entering, signal is SELL or HOLD** → note the signal doesn't support entering right now.
- **Considering exiting** → same pattern: state whether the signal agrees or disagrees with that instinct, nothing more.

Never produce a specific action (share counts, dollar amounts, "sell now," "buy the dip," price targets, timing). That crosses from describing a signal into personalized financial advice, which is out of scope here — if the user pushes for a specific number, say plainly that this tool reports signals, not trade sizing, and they should make that call themselves (or via a licensed advisor).

Always note the deterministic vs. AI-read agreement/disagreement from the report, the same as `stock-read` does — the position framing sits on top of that, it doesn't replace it.
