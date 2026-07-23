# @stock-indicator-dailies/vlm

The VLM analysis layer — everything between a chart screenshot and a validated
`Verdict`, split so the deterministic parts are unit-tested and the flaky,
model-dependent part is isolated behind an interface.

## What's here

- **`prompt.ts`** — `buildSystemPrompt()` / `buildUserInstruction()`. The prompt is
  assembled from `@stock-indicator-dailies/shared` constants (indicator params,
  Stochastic bands, 3-month window), so what the model is told can never drift from
  what the agent configures or what the evals label against.
- **`extract.ts`** — `extractJson()`. Recovers a JSON value from raw model text,
  tolerating ```` ```json ```` fences and surrounding prose.
- **`provider.ts`** — `VlmProvider` interface + `ChartImage` / `VlmRequest` types. The
  provider-agnostic seam; concrete Gemini/GPT adapters plug in here.
- **`analyze.ts`** — `interpretChartResponse()` (raw text → validated result) and
  `analyzeChart()` (build prompt → call provider → interpret).

## Trust boundaries

- The requested **ticker is authoritative** — injected into the payload, never taken
  from the model's echo.
- The overall **signal is authoritative** — recomputed by `parseVerdict` /
  `deriveSignal` from the readings; the model's own overall call is only cross-checked.
- The **provider** is the only component that touches the network or the real model.
  In tests it's a fake that returns canned strings — no keys, no network, not flaky.

## Not yet implemented

Concrete providers (a Gemini / GPT-class adapter behind `VlmProvider`, selected via
`VLM_PROVIDER`) are the next chunk — they need an SDK, an API key, and live calls, and
belong under integration/eval coverage rather than unit tests.

## Develop

```bash
npm test -w @stock-indicator-dailies/vlm
npm run typecheck
```
