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

## Scoring

`score.ts` compares predicted vs. oracle per-indicator signals and aggregates
accuracy (overall and per indicator), listing every disagreement.

## Superseded

The single-bar legend oracle (`oracle.ts`) only reads *current state*, so it
cannot see a crossover's age. It's kept for its `IndicatorValues` type (reused by
calibration) but is not used to grade the event model.

## Still to build

The harness: capture N charts (agent) + fetch their OHLC + run the VLM + score,
run with thinking on vs off to settle the accuracy/speed tradeoff. That part
makes live, billed model calls.

## Develop

```bash
npm test -w @stock-indicator-dailies/eval-interpretation   # pure, offline
```
