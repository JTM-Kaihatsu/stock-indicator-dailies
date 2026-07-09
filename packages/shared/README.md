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

`deriveSignal()` implements **"confluence without contradiction"**:

- **BUY** if ≥ `minConsensus` indicators read BUY and none read SELL.
- **SELL** if ≥ `minConsensus` indicators read SELL and none read BUY.
- **HOLD** otherwise — including any contradiction (at least one BUY *and* one SELL),
  which always resolves to HOLD.

`minConsensus` defaults to **2** (majority of 3). Pass `{ minConsensus: 3 }` for
unanimity or `{ minConsensus: 1 }` for a looser policy.

```ts
import { deriveSignal, readingsFromSignals } from '@stock-dailies/shared';

deriveSignal(readingsFromSignals([
  ['macd', 'BUY'],
  ['slowStochastic', 'BUY'],
  ['sma', 'NEUTRAL'],
])); // => 'BUY'
```

## Develop

```bash
npm test -w @stock-dailies/shared        # node:test, native TS
npm run typecheck -w @stock-dailies/shared
```
