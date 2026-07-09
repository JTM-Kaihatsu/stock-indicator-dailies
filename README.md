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
  │  (Gemini/GPT)     │   criteria → structured JSON          └───────────────────┘
  └───────────────────┘
            │
            ▼
  Daily Report card: screenshot + Buy / Sell / Hold recommendation
```

## Signal criteria

The signal is derived from three indicators with fixed parameters.

| Indicator          | Buy signal                                                        | Sell signal                                                        |
| ------------------ | ----------------------------------------------------------------- | ------------------------------------------------------------------ |
| **MACD (8, 17, 9)**  | Bullish crossover (MACD line crosses **above** signal) below zero | Bearish crossover (MACD line crosses **below** signal) above zero  |
| **Slow Stoch (14, 5)** | %K crosses **above** %D while oversold (< 20)                   | %K crosses **below** %D while overbought (> 80)                    |
| **10-day SMA**       | Price closes **above** the 10-day SMA with upward slope           | Price closes **below** the 10-day SMA with downward slope          |

Indicator parameters: MACD fast 8 / slow 17 / signal 9 · Slow Stochastic %K 14 / %D 5 · SMA period 10.

## Tech stack

| Layer          | Choice                          | Purpose                                          |
| -------------- | ------------------------------- | ------------------------------------------------ |
| Frontend       | Next.js                         | Responsive dashboard + Daily Report cards        |
| Agentic layer  | Playwright + light orchestration| Log in, configure indicators, capture chart      |
| AI layer       | Frontier VLM (Gemini/GPT-class) | Multimodal image reasoning, JSON-structured output |
| Database       | Supabase                        | User preferences & "Daily" history               |
| Evals          | SSIM + labeled ground truth     | Guard against retrieval failures & model drift   |

## Repository layout

```
stock-indicator-dailies/
├── apps/
│   └── web/                 # Next.js dashboard (frontend)
├── packages/
│   ├── agent/               # Playwright browser-automation layer
│   ├── vlm/                 # VLM analysis + prompts (Gemini/GPT-class)
│   └── shared/              # Shared types & signal-criteria definitions
├── evals/
│   ├── retrieval/           # SSIM-based chart-retrieval eval (target ≥ 95%)
│   └── interpretation/      # Buy/Sell/Hold vs. labeled ground truth
├── supabase/                # Schema & migrations
└── docs/                    # PRD, architecture, roadmap
```

> **Status:** Docs & structure only. Application code lands in later commits — see [docs/ROADMAP.md](docs/ROADMAP.md).

## Getting started

Prerequisites: Node.js 20+, npm, and a Playwright-capable environment. AI + DB integration
require a VLM API key (Gemini/GPT-class) and a Supabase project (see [`.env.example`](.env.example)).

```bash
git clone https://github.com/JTM-Kaihatsu/stock-indicator-dailies.git
cd stock-indicator-dailies
cp .env.example .env.local   # then fill in your keys
```

Scaffolding for `apps/web` and the packages is not yet in place. Once added, per-package
setup instructions will live in their respective READMEs.

## Security & privacy

Because the agent authenticates into external charting/brokerage platforms on your behalf,
security is a first-class concern. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#security--risk)
for the full model. Highlights:

- **Read-only, no trade execution** — trade execution is explicitly out of scope for the MVP.
- **Encrypted, local-first credentials** — secrets live in OS-level vaults (e.g. Keychain), never in plaintext or logs, never on centralized servers.
- **Token-based auth preferred** — OAuth / scoped read-only API keys over passwords.
- **Image sanitization** — screenshots are regionally cropped to strip account-identifying metadata.

## Roadmap

Phase II extends Stock Indicator Dailies into financial-statement extraction and analysis. See
[docs/ROADMAP.md](docs/ROADMAP.md).

## License

_No license chosen yet._ This public repository is currently "all rights reserved" by default.
Add a `LICENSE` file to grant usage rights.
