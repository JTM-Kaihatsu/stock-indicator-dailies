# @stock-dailies/shared

The single source of truth for Stock Dailies' domain logic. Everything else — the
Playwright agent, the Gemini VLM wrapper, the web UI, and both eval suites — imports
from here instead of re-encoding indicator settings or signal rules.

## What's here

- **`indicators.ts`** — Fixed indicator parameters (`INDICATOR_PARAMS`: MACD 8/17/9,
  Slow Stoch 14/5, SMA 10) and the Stochastic oversold/overbought bands.
- **`types.ts`** — `Signal` (`BUY | SELL | HOLD`), `IndicatorReading`, and the `Verdict`
  shape the VLM must return.
- **`signal.ts`** — `deriveSignal()`, the pure function that combines per-indicator
  readings into an overall recommendation, plus `tallyReadings()`.

## Signal policy

`deriveSignal()` implements an **asymmetric, risk-averse** policy — a higher bar to
enter than to step aside:

- **SELL** if ≥ `sellConsensus` indicators read SELL (default **2**).
- **BUY** if ≥ `buyConsensus` indicators read BUY (default **3** — unanimity).
- **HOLD** otherwise.

SELL is evaluated first, so if the thresholds are ever lowered such that both could
match, the protective (exit) signal wins.

```ts
import { deriveSignal, readingsFromSignals } from '@stock-dailies/shared';

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

## Develop

```bash
npm test -w @stock-dailies/shared        # node:test, native TS
npm run typecheck -w @stock-dailies/shared
```
