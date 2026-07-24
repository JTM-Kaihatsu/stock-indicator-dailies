# @stock-indicator-dailies/daily

Orchestration: **ticker in → Daily Report out.** Chains the agent (capture) and
the VLM (interpretation) into one call, and is the only package that depends on
both — `agent` and `vlm` stay independent of each other.

## Run one

```bash
npm run daily -w @stock-indicator-dailies/daily -- NVDA
# optionally save the source chart:
npm run daily -w @stock-indicator-dailies/daily -- NVDA testing/nvda.png
```

Drives a real browser and makes a live (billed) model call. Requires a signed-in
profile (`npm run login -w @stock-indicator-dailies/agent`) and `VLM_API_KEY` in
`.env.local`.

## `runDaily()`

```ts
const result = await runDaily({ ticker, agent, provider });
if (result.ok) {
  result.report.verdict;   // BUY | SELL | HOLD + per-indicator readings
  result.report.image;     // the chart the verdict came from
  result.report.timings;   // capture / analyze / total, vs the 15s target
  result.report.warnings;  // e.g. the model's own signal disagreeing with ours
}
```

**Failures are returned, not thrown**, and tagged with the stage that failed —
because the responses differ:

| Stage | Reason | What it means |
|---|---|---|
| `capture` | `not-authenticated` | Session expired → re-run the login |
| `capture` | `chart-not-found` | Saved layout changed, or a study is missing/misconfigured |
| `capture` | `wrong-interval` | Chart isn't on daily bars — indicators would be wrong |
| `capture` | `timeout` | Provider slow or unreachable |
| `analysis` | `invalid-verdict` | Model output wasn't parseable/valid |

A failed capture **short-circuits before any model call**, so a broken chart
never costs a billed request (covered by a test).

## Guarantees carried through

- The overall signal is always recomputed by `deriveSignal` — the model's own
  call is cross-checked and surfaced as a warning, never trusted.
- The source image is returned with every report so a human can verify the call
  (the PRD's human-in-the-loop requirement).
- Time-to-signal is measured against `SUCCESS_TARGETS.timeToSignalMs`.

## Develop

```bash
npm test -w @stock-indicator-dailies/daily   # fully mocked: no browser, no network
```
