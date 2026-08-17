# Stock Indicator Dailies

> An AI-driven technical-analysis utility that automates the daily ritual of checking market signals.

**Stock Indicator Dailies** turns the repetitive chore of logging into a charting platform, configuring
indicators, and eyeballing crossovers into a single click. You enter a ticker; an autonomous
browser agent logs in, applies a fixed indicator set, screenshots the chart, and a Visual
Language Model (VLM) reads it back to you as a **Buy / Sell / Hold** signal.

> [!IMPORTANT]
> This is **not financial advice**. Stock Indicator Dailies is a data-acquisition and reporting tool.
> Every final investment decision remains the sole responsibility of the user.

---

## How it works

```
  User enters ticker (e.g. NVDA)
            │
            ▼
  ┌───────────────────┐   logs in, applies indicators, screenshots
  │  Agentic Layer    │──────────────────────────────────────────────┐
  │  (Playwright)     │                                               │
  └───────────────────┘                                               ▼
            │                                              high-res chart PNG
            │                                                         │
            ▼                                                         ▼
  ┌───────────────────┐   interprets crossovers vs. signal   ┌───────────────────┐
  │  VLM Analysis     │◀─────────────────────────────────────│  Chart image      │
  │  (Claude)         │   criteria → structured JSON          └───────────────────┘
  └───────────────────┘
            │
            ▼
  Daily Report card: screenshot + Buy / Sell / Hold recommendation
```

## Signal criteria

The signal is derived from three indicators with fixed chart parameters, but a tunable
decision policy; the consensus thresholds and recency window are all adjustable from the
web UI's Indicator Settings panel (defaults shown below).

| Indicator          | Buy signal                                                        | Sell signal                                                        |
| ------------------ | ----------------------------------------------------------------- | ------------------------------------------------------------------ |
| **MACD (8, 17, 9)**  | Bullish crossover (MACD line crosses **above** signal) below zero | Bearish crossover (MACD line crosses **below** signal) above zero  |
| **Slow Stoch (14, 5, 3)** | %K crosses **above** %D while oversold (< 20)                | %K crosses **below** %D while overbought (> 80)                    |
| **10-day SMA**       | Price crosses **above** the 10-day SMA while it's sloping up      | Price crosses **below** the 10-day SMA while it's sloping down     |

A crossover only counts if it happened within the last 3 days (default); older ones read as
no signal. The three per-indicator reads are then combined: **SELL** requires unanimity
(3 of 3), **BUY** requires only 2 of 3, otherwise **HOLD**; backtesting showed this
asymmetric policy (easy to exit, harder to re-enter) outperforms a symmetric one more
consistently. See `evals/backtest` and the in-app Historical Testing panel to validate any
policy change against real history before trusting it.

## Tech stack

| Layer          | Choice                                                | Purpose                                                |
| -------------- | ------------------------------------------------------| ------------------------------------------------------ |
| Frontend       | Next.js (Vercel)                                      | Dashboard, Indicator Settings, Historical Testing UI   |
| API            | Hono (Render)                                         | Pipeline orchestration, backtest, AI-advisor endpoints |
| Agentic layer  | Playwright                                            | Log in, configure indicators, capture chart            |
| AI layer       | Claude (vision read + `web_search` tool-use advisor)  | Chart interpretation; settings-tuning research          |
| Database       | Supabase                                              | Chart cache, AI-suggestion cache, failure logs           |
| Evals          | Labeled ground truth + walk-forward backtest          | Guard against interpretation drift & bad policy changes |

## Repository layout

```
stock-indicator-dailies/
├── apps/
│   ├── web/             # Next.js dashboard (frontend, deployed on Vercel)
│   └── api/              # Hono API: pipeline orchestration, caching, job/poll routes (deployed on Render)
├── packages/
│   ├── agent/            # Playwright browser-automation layer
│   ├── vlm/              # Claude vision analysis + prompts
│   ├── advisor/          # Claude + web_search settings-tuning advisor
│   ├── daily/             # Daily pipeline orchestration (capture -> analyze -> report)
│   ├── indicators/        # Deterministic indicator math (MACD/Stochastic/SMA/ATR/ADX)
│   └── shared/            # Shared types & signal-criteria definitions
├── evals/
│   ├── interpretation/   # Buy/Sell/Hold vs. labeled ground truth
│   ├── backtest/          # Walk-forward backtest of the policy vs. buy-and-hold
│   └── retrieval/         # SSIM-based chart-retrieval eval (target >= 95%); not started
├── supabase/              # Schema & migrations
└── docs/                  # PRD, architecture, roadmap
```

## Getting started

Prerequisites: Node.js 22+, npm, and a Playwright-capable environment. AI integration requires
a Claude API key; the chart and AI-suggestion caches require a Supabase project (see
[`.env.example`](.env.example) for the full list).

```bash
git clone https://github.com/JTM-Kaihatsu/stock-indicator-dailies.git
cd stock-indicator-dailies
cp .env.example .env.local   # then fill in your keys
npm install

npm run dev:api    # Hono API on :3001
npm run dev:web    # Next.js dashboard on :3000, in a second terminal

npm test           # full test suite across every package
npm run typecheck  # every workspace
```

## Security & privacy

Because the agent authenticates into external charting/brokerage platforms on your behalf,
security is a first-class concern. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#security--risk)
for the full model. Highlights:

- **Read-only, no trade execution**; trade execution is explicitly out of scope for the MVP.
- **Encrypted, local-first credentials**; secrets live in OS-level vaults (e.g. Keychain), never in plaintext or logs, never on centralized servers.
- **Token-based auth preferred**; OAuth / scoped read-only API keys over passwords.
- **Image sanitization**; screenshots are regionally cropped to strip account-identifying metadata.

## Roadmap

Phase II extends Stock Indicator Dailies into financial-statement extraction and analysis. See
[docs/ROADMAP.md](docs/ROADMAP.md).

## License

_No license chosen yet._ This public repository is currently "all rights reserved" by default.
Add a `LICENSE` file to grant usage rights.
