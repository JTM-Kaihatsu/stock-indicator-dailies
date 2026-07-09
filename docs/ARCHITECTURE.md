# Architecture

This document describes the intended architecture for the Stock Dailies MVP. It is the reference
that the (not-yet-written) application code will be built against.

## Components

```
┌──────────────────────────────────────────────────────────────────────────┐
│                            apps/web  (Next.js)                             │
│   Dashboard · ticker input · Daily Report cards · history view            │
└───────────────┬──────────────────────────────────────────┬───────────────┘
                │ triggers a "Daily" run                    │ reads history
                ▼                                           ▼
┌───────────────────────────────┐                ┌──────────────────────────┐
│    packages/agent (Playwright) │                │      supabase            │
│  login → set indicators →      │                │  preferences · dailies   │
│  screenshot → crop/sanitize    │                │  history                 │
└───────────────┬───────────────┘                └──────────────────────────┘
                │ sanitized chart PNG
                ▼
┌───────────────────────────────┐
│      packages/vlm (Gemini)     │
│  system prompt + criteria →    │
│  structured JSON verdict       │
└───────────────┬───────────────┘
                │ { signal, rationale, per-indicator }
                ▼
        Daily Report (persisted to Supabase, rendered in web)
```

- **`apps/web`** — Next.js dashboard. Single ticker input, triggers a run, renders the Daily Report
  card (screenshot + Buy/Sell/Hold + per-indicator rationale), and shows historical dailies.
- **`packages/agent`** — Playwright automation. Logs into the charting provider, enters the ticker,
  applies the fixed indicator set, captures a high-res screenshot, then crops/sanitizes it.
- **`packages/vlm`** — Wraps the Gemini API. Owns the system prompt and returns a structured JSON
  verdict validated against a schema in `packages/shared`.
- **`packages/shared`** — Cross-cutting TypeScript types, the indicator parameter constants, and the
  signal-criteria definitions (single source of truth shared by agent, vlm, web, and evals).
- **`evals/`** — Independent evaluation of the two failure-prone stages (see [Evaluation](#evaluation)).
- **`supabase/`** — Schema and migrations for user preferences and daily history.

## Data flow (one "Daily")

1. User submits a ticker in the web app.
2. Web calls the agent to run acquisition for that ticker.
3. Agent logs in, applies MACD 8/17/9, Slow Stoch 14/5, SMA 10, screenshots, crops/sanitizes.
4. Agent performs **structural validation** — confirms all three indicators are present in the
   frame before proceeding (guards against DOM volatility).
5. Sanitized PNG → VLM with system prompt + criteria → structured JSON verdict.
6. Verdict + screenshot reference persisted to Supabase and rendered as a Daily Report card.

## Fixed indicator parameters

Defined once in `packages/shared` and consumed everywhere:

| Indicator      | Parameters                                  |
| -------------- | ------------------------------------------- |
| MACD           | Fast 8 · Slow 17 · Signal 9                 |
| Slow Stochastic| %K 14 · %D 5                                |
| SMA            | Period 10                                   |
| Chart window   | 3 months (all indicators)                   |

## Evaluation

The two stages most prone to failure/drift are evaluated **independently** so a regression in one
is not masked by the other.

- **`evals/retrieval`** — Simulate the web navigation + screenshot retrieval against a fixed test
  set of pages. Use **SSIM** to confirm the correct chart was captured. **Target ≥ 95% similarity.**
- **`evals/interpretation`** — Feed labeled chart images (with ground-truth buy/sell/hold) to the
  VLM and assert the output matches. **Target 100% accuracy** on the labeled set.

## Security & risk

> Full rationale in [PRD.md](PRD.md#security--risk-considerations). Design commitments:

- **Read-only, no trade execution.** Trade execution is explicitly out of scope for the MVP. The
  agent operates under least privilege — chart rendering access only.
- **Local-first credentials.** Secrets live in OS-level vaults (e.g. Keychain), never in plaintext,
  logs, or on centralized servers. Prefer OAuth / scoped read-only API keys over passwords.
- **Bot mitigation.** Human-like interaction timing and strict rate limiting; official APIs
  preferred over scraping to stay within provider ToS.
- **Image sanitization.** Regional cropping strips account-identifying metadata; captured images
  stay within internal Dailies history and are never broadcast externally.
- **Data sovereignty.** Users can trigger a complete history purge at any time.

## Open decisions

- Charting provider(s) to support first (TradingView vs. StockCharts vs. brokerage API).
- Whether the agent runs locally (aligns with local-first) or in a controlled backend, and how that
  reconciles with keeping credentials on-device.
- VLM provider lock-in vs. an abstraction that allows swapping Gemini/GPT-4o.
- Monorepo tooling (npm/pnpm workspaces, Turborepo?) — decide when app code is scaffolded.
