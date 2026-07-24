# @stock-indicator-dailies/eval-interpretation

Grades the VLM's chart reading against a **computed oracle**, to measure the
PRD's interpretation-accuracy target. This is the biggest open risk in the
system: we have almost no evidence yet that Claude reads these charts correctly.

## The oracle

Ground truth comes from **TradingView's own legend values** at the last bar,
read off the chart the model is looking at — each value cell carries a `title`
attribute (`MACD`, `Signal line`, `%K`, `%D`, `MA`), so there's no positional
guessing and no formula-parity risk with a separately computed indicator.

`oracle.ts` maps those numbers → per-indicator BUY/SELL/NEUTRAL. `score.ts`
compares the VLM's readings to the oracle and aggregates accuracy per indicator.

## ⚠️ State vs. event — the key semantic caveat

A single legend snapshot gives the values at the **last bar only**. It cannot
see the previous bar, so it cannot detect a fresh **crossover event** or a
**slope direction**. The oracle therefore grades the criteria as current-*state*
conditions:

| Criterion (literal) | Oracle (state proxy) |
|---|---|
| MACD *crosses above* signal below zero | MACD *is above* signal AND below zero |
| MACD *crosses below* signal above zero | MACD *is below* signal AND above zero |
| %K *crosses above* %D while oversold | %K *is above* %D AND oversold |
| %K *crosses below* %D while overbought | %K *is below* %D AND overbought |
| price closes above SMA *with upward slope* | close *is above* SMA (slope not checked) |
| price closes below SMA *with downward slope* | close *is below* SMA (slope not checked) |

This is looser than the literal wording, and it only grades the VLM **fairly if
the VLM is judged on the same definition.** The prompt currently says "crosses"
(event); the oracle measures state. So some disagreements will be definitional,
not model errors — e.g. the oracle says SELL because MACD is currently below
signal, while the VLM correctly reports NEUTRAL because no cross happened today.

**Open decision:** align both on *state* (reword the prompt — makes the product
a "current configuration" tool that can fire the same signal for many days), or
both on *event* (needs a second legend read at the previous bar, so the oracle
can detect the actual cross and slope). The first run will show empirically how
often this divergence bites.

## Status

Oracle + scoring are built and unit-tested (against the real captured NVDA
legend). Still to build: the harness that captures N charts with their legend
values, runs the VLM on each, and reports the scorecard — that part makes live,
billed model calls.
