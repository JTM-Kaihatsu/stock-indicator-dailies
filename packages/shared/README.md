# @stock-indicator-dailies/shared

The single source of truth for Stock Indicator Dailies' domain logic. Everything else — the
Playwright agent, the VLM wrapper, the web UI, and both eval suites — imports
from here instead of re-encoding indicator settings or signal rules.

## What's here

- **`indicators.ts`** — Fixed indicator parameters (`INDICATOR_PARAMS`: MACD 8/17/9,
  Slow Stoch 14/5, SMA 10), the Stochastic oversold/overbought bands, and
  `CHART_WINDOW` (the 3-month timeframe all indicators are read over).
- **`types.ts`** — `Signal` (`BUY | SELL | HOLD`), `IndicatorReading`, and the `Verdict`
  shape the VLM must return.
- **`signal.ts`** — `deriveSignal()`, the pure function that combines per-indicator
  readings into an overall recommendation, plus `tallyReadings()`.
- **`verdict.ts`** — `parseVerdict()`, which validates raw VLM JSON into a trustworthy
  `Verdict` and recomputes the overall signal from the readings (the model's own
  overall call is only cross-checked, never trusted).

## Signal policy

`deriveSignal()` implements an **asymmetric, risk-averse** policy — a higher bar to
enter than to step aside:

- **SELL** if ≥ `sellConsensus` indicators read SELL (default **2**).
- **BUY** if ≥ `buyConsensus` indicators read BUY (default **3** — unanimity).
- **HOLD** otherwise.

SELL is evaluated first, so if the thresholds are ever lowered such that both could
match, the protective (exit) signal wins.

```ts
import { deriveSignal, readingsFromSignals } from '@stock-indicator-dailies/shared';

deriveSignal(readingsFromSignals([
  ['macd', 'BUY'],
  ['slowStochastic', 'BUY'],
  ['sma', 'NEUTRAL'],
])); // => 'HOLD'  (BUY needs all three)

deriveSignal(readingsFromSignals([
  ['macd', 'SELL'],
  ['slowStochastic', 'SELL'],
  ['sma', 'BUY'],
])); // => 'SELL'  (two SELL is enough)
```

Override the thresholds via `deriveSignal(readings, { buyConsensus, sellConsensus })`.

## Validating VLM output

`parseVerdict(rawJson)` turns untrusted model output into a `Verdict`:

- **Structural validation** — object shape, known indicators, valid enums, no
  duplicate/missing indicators, well-formed ticker and optional ISO `capturedAt`.
  Failures return `{ ok: false, errors }`.
- **Authoritative signal** — the overall `signal` is always recomputed with
  `deriveSignal(readings)`. If the model also returned an overall signal, a mismatch
  (or invalid value) comes back as a **warning**, not an error — the derived signal wins.

```ts
import { parseVerdict } from '@stock-indicator-dailies/shared';

const result = parseVerdict(modelJson);
if (result.ok) {
  const { verdict, warnings } = result; // verdict.signal is trustworthy
} else {
  console.error(result.errors);
}
```

Accepts the same `buyConsensus`/`sellConsensus` options as `deriveSignal`, plus
`requireAllIndicators` (default `true`).

## Develop

```bash
npm test -w @stock-indicator-dailies/shared        # node:test, native TS
npm run typecheck -w @stock-indicator-dailies/shared
```
