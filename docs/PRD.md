# Stock Dailies MVP — Product Requirements Document

- **Project Owner:** Takeshi
- **Date:** July 8, 2026
- **Status:** Draft / Conceptual

## Project overview

"Stock Dailies" is an AI-driven technical-analysis utility designed to streamline the daily
ritual of checking market signals. Driven from a personal need to gamify the boring, repetitive
task of logging in and reading off charts, the tool automates the tedious process of navigating
financial charting platforms, configuring technical indicators, and performing visual pattern
recognition. It provides a **Buy, Sell, or Hold** signal based on whether the corresponding
MACD, Slow Stochastic, and Simple 10-day MA lines have crossed.

A planned **Phase II** extends this into financial-statement extraction and analysis/synthesis.
See [Future features](#future-features).

> **Note:** This is not meant to provide financial advice, just to more easily obtain data.

## Target audience

- **Retail traders** who utilize specific technical setups but want to save time on manual chart adjustment.

## Core feature requirements

### 1. Ticker entry & session management

A clean, single-input field for the equity or ETF ticker symbol.

- **Ticker input:** Support for standard exchange tickers (e.g. AAPL, NVDA, TSLA).
- **Credential storage:** Encrypted local storage or secure vault for charting-platform login
  credentials (e.g. TradingView, StockCharts, or brokerage APIs).

### 2. Agentic chart acquisition

An autonomous browser agent (e.g. Playwright or a dedicated AI web agent) performs:

1. **Navigation:** Log in to the specified charting provider.
2. **Input ticker:** Enter the user-provided symbol into the primary search bar.
3. **Parameter configuration:**
   - **MACD:** Fast Length 8, Slow Length 17, Signal Smoothing 9.
   - **Slow Stochastic:** %K 14, %D 5.
   - **Simple Moving Average (SMA):** Period 10.
4. **Visual capture:** High-resolution screenshot of the rendered chart area, ensuring all three
   indicators are clearly visible within the frame.

### 3. Visual Language Model (VLM) analysis

The captured screenshot is passed to a VLM (e.g. Gemini 1.5 Pro or GPT-4o) with a specific system
prompt to interpret the technical data against these criteria:

| Indicator            | Buy signal criteria                                                | Sell signal criteria                                              |
| -------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------- |
| **MACD (8, 17, 9)**    | Bullish crossover (MACD line crosses above signal line) below zero | Bearish crossover (MACD line crosses below signal line) above zero |
| **Slow Stoch (14, 5)** | %K crosses above %D while oversold (< 20)                          | %K crosses below %D while overbought (> 80)                       |
| **10-day SMA**         | Price closes above the 10-day SMA with upward slope                | Price closes below the 10-day SMA with downward slope             |

## System workflow

1. **Trigger:** User enters "NVDA" into the Stock Dailies dashboard.
2. **Execution:** The agentic layer wakes up, logs into the charting tool, applies the 8/17/9 MACD,
   14/5 Stochastics, and 10-SMA, and snaps a PNG.
3. **Inference:** The VLM analyzes the PNG against the criteria.
4. **Reporting:** The UI displays a "Daily Report" card showing the screenshot and the final recommendation.

## Technical stack recommendations

- **Frontend:** Next.js for a responsive, modern web dashboard.
- **Agentic layer:** Playwright for browser automation combined with a lightweight orchestration framework.
- **AI layer:** Gemini API (1.5 Pro) for multimodal image reasoning and JSON-structured output.
- **Database:** Supabase for user preferences and "Daily" history tracking.

**Track model drift for two parts:**

- **Retrieval:** Simulate web-page process and screenshot retrieval; use Structural Similarity
  Index Measure (SSIM) to determine match.
- **Chart interpretation:** Given a chart image with ground-truth buy/sell/hold, assert model results.

## Security & risk considerations

### 1. Credential management & security

The primary concern is the autonomous agent authenticating into external charting/brokerage
environments on behalf of the user. Mitigations:

- **Encrypted secret storage:** Plaintext logging/storage of sensitive data is strictly prohibited.
  Credentials secured at rest via OS-level vaults (e.g. Keychain) or dedicated managers, with
  isolation between keys and payloads.
- **Token-based authentication:** Prioritize OAuth or scoped API keys (specifically read-only market
  data) over passwords. The tool observes data without the capability to execute transactions.
- **Permission scoping:** Least privilege — access restricted solely to chart rendering. Trade
  execution is explicitly excluded from the MVP roadmap.
- **Local-first architecture:** Credentials remain on the local device and are not transmitted to
  centralized servers.

### 2. Automation failure modes

- **DOM volatility:** Layout shifts can disrupt navigation. Structural validation of the screenshot
  ensures all three indicators are captured before inference.
- **Compliance review:** Automation must align with provider ToS. Official API integration is
  preferred over scraping.
- **Bot mitigation:** Human-like interaction timing and strict rate-limiting to prevent account suspension.

### 3. VLM reliability & verification

- **Hallucination safeguards:** VLMs may misidentify patterns. Mitigated via an SSIM-based eval
  framework and by displaying the source screenshot for manual verification.
- **Human-in-the-loop:** The system is a reporting tool only. Final decisions remain the user's.

### 4. Data stewardship & privacy

- **Local data sovereignty:** All session logs, preferences, and cached assets managed via Supabase
  (or similar local-first persistent storage). Users retain full ownership with the ability to
  trigger a complete history purge.
- **Image sanitization:** Regional cropping on all screenshots to prevent exposure of
  account-identifying metadata. Captured visual data is restricted to internal "Dailies" history
  and never broadcast externally.

## Success metrics

- **Time-to-signal:** Acquisition and analysis completed in under 15 seconds.
- **Accuracy:** Retrieval and interpretation measured and tested independently to assess
  performance and prevent model drift.
  - Chart retrieval compared to a series of web pages in a test set; SSIM used to confirm the chart
    was correctly obtained (**target ≥ 95% similarity**).
  - Buy/sell/hold interpretation matches labeled ground-truth labels on a test set with **100% accuracy**.
- **Engagement:** User completes their "Dailies" for at least **5 consecutive trading days**.

## Future features

- Designate preferred technical indicator and parameters.
- Notification system for daily reporting sent via email.
- Saved sessions to preserve portfolio reporting + changes over time.

### Phase II: Financials

- **OCR:** Use AWS Textract for table and text blocks.
- **LLM:** Pull and extract key numbers from financials.
- **Map:** Obtain relevant embeddings based on k-NN heuristic.
- **Reduce:** Apply extraction logic based on contextual information, datatyping, and non-LLM
  mathematical cross-checks for business logic.
- **Algorithmic:** Calculate ratios and percent change between 10-year, 5-year, 3-year, and 1-year
  (present to frontend).
- **LLM interpretation** of ratios; potentially pull latest news and public opinion on the company
  and synthesize.
