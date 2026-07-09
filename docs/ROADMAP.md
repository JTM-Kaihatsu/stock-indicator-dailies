# Roadmap

Status legend: ⬜ not started · 🟡 in progress · ✅ done

## Phase 0 — Foundations (current)

- ✅ PRD captured ([PRD.md](PRD.md))
- ✅ Architecture defined ([ARCHITECTURE.md](ARCHITECTURE.md))
- ✅ Repository structure & conventions
- ✅ Monorepo tooling — npm workspaces; TypeScript run/tested natively via `node --test` (zero runtime test deps)
- ✅ `packages/shared`: indicator constants, verdict types, and `deriveSignal()` decision logic — asymmetric policy (BUY needs all 3, SELL needs 2), 18 unit tests

## Phase 1 — MVP

Goal: enter a ticker → get a Buy/Sell/Hold Daily Report in under 15 seconds.

- ⬜ **Web** (`apps/web`): Next.js dashboard, single ticker input, Daily Report card
- ⬜ **Agent** (`packages/agent`): Playwright login → indicator config → screenshot → crop/sanitize
- ⬜ **Agent**: structural validation that all three indicators are in-frame before inference
- ⬜ **VLM** (`packages/vlm`): Gemini system prompt + structured JSON verdict
- ⬜ **DB** (`supabase`): schema for preferences + daily history; history purge
- ⬜ **Security**: OS-vault credential storage; read-only scoping; no trade-execution paths
- ⬜ **Evals**: `retrieval` (SSIM ≥ 95%) and `interpretation` (100% on labeled set)
- ⬜ **Metric**: instrument time-to-signal (< 15s target)

## Phase 1.5 — Quality-of-life

- ⬜ Designate preferred technical indicators & parameters
- ⬜ Email notifications for the daily report
- ⬜ Saved sessions to preserve portfolio reporting + changes over time

## Phase 2 — Financials

Extend into financial-statement extraction & synthesis.

- ⬜ **OCR**: AWS Textract for table & text blocks
- ⬜ **LLM extract**: pull key numbers from financials
- ⬜ **Map**: relevant embeddings via k-NN heuristic
- ⬜ **Reduce**: extraction logic with datatyping + non-LLM mathematical cross-checks
- ⬜ **Algorithmic**: ratios & percent change across 10y / 5y / 3y / 1y
- ⬜ **LLM interpret**: synthesize ratios, optionally with latest news / public opinion
