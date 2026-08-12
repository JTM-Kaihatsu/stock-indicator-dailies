# @stock-indicator-dailies/eval-interpretation

Grades the VLM's chart reading against a **computed oracle**, to measure the
PRD's interpretation-accuracy target. This is the biggest open risk in the
system: whether Claude actually reads these charts correctly.

## The event oracle

The signal model is event-based (a *clean crossover, N bars ago, qualified*), so
the oracle needs the indicator **time series**, not a single bar. It:

1. Fetches daily OHLC (`ohlc.ts` — keyless Yahoo Finance, behind a `DataSource`
   interface so the math stays offline-testable).
2. Computes the series (`compute.ts` — SMA, EMA, MACD, Slow Stochastic; matches
   TradingView's default formulas).
3. Detects the most recent crossover as a sign-flip of the difference series
   (`crossovers.ts`), giving direction + `barsAgo` + the zone/slope `qualified`
   flag — the exact `{crossover, barsAgo, qualified}` shape the VLM produces
   (`event-oracle.ts`).

### Calibration — the parity check

`calibrate.ts` compares the computed last-bar values to **TradingView's own
legend numbers** (captured alongside the chart). This turns "does my math match
TradingView's math" from a hope into a checked invariant, and catches data-source
mismatches too. Validated live on GEV — every value agrees to within 0.003:

```
node evals/interpretation/calibrate-live.ts GEV
  ✓ macd.macd   computed -15.357  tv -15.360  Δ 0.003
  ✓ sma         computed 1040.088 tv 1040.090 Δ 0.002
  ...  calibration: ✅ PASS
```

## Two independent reads — neither is ground truth

The eval surfaces **two reads per chart** and does NOT declare a winner:

- the **VLM** read (the AI second opinion), and
- the **fetched** read, computed from Yahoo price data (calibrated to
  TradingView to <0.003 — see calibration above).

Both are shown to the user (and to the FE); the human labels the real answer.
So the eval reports **agreement** between the two reads, not accuracy against a
reference.

## Comparing the reads

`score.ts` compares per-indicator **signals** (BUY/SELL/NEUTRAL) and aggregates.

`fact-score.ts` compares one level deeper — the raw **facts** each read carries:
crossover *direction*, *barsAgo*, and the *qualified* flag, plus the derived
signal. This attributes a disagreement to perception (direction), timing
(barsAgo gap), or the judgment layer (recency). It exists because the GEV
disagreement was a pure barsAgo gap (VLM 2d vs fetched 5d) that straddled the
3-bar recency window — invisible to signal-only comparison.

## The harness

`harness.ts` (`runEval`) is the batch runner: for each ticker it captures the
chart, runs the VLM, computes the fetched read, and records both plus their
agreement. Every dependency is injected, so it runs offline in tests with the
fake agent + a stub provider. `report.ts` renders a terminal summary;
`csv.ts` exports a per-(ticker, indicator) sheet with both reads side by side
and blank `truth_*` columns for hand-labeling.

Live run (drives a real browser, one billed model call per ticker):

```bash
npm run eval -w @stock-indicator-dailies/eval-interpretation -- GEV NVDA AAPL
```

Tickers are required — a bare run refuses rather than silently billing. Writes
`eval-interpretation.json` (full record) and `eval-interpretation.csv` (open in
Excel, fill the `truth_*` columns to label ground truth).

## Superseded

The single-bar legend oracle (`oracle.ts`) only reads *current state*, so it
cannot see a crossover's age. It's kept for its `IndicatorValues` type (reused by
calibration) but is not used to grade the event model.

## Still to build

- A curated ticker set to run against (currently the caller passes them on the
  command line).
- A thinking-on vs. thinking-off comparison mode, to settle the accuracy/speed
  tradeoff from the same harness.

## Develop

```bash
npm test -w @stock-indicator-dailies/eval-interpretation   # pure, offline
```
