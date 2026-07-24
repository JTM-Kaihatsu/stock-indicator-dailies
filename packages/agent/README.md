# @stock-indicator-dailies/agent

Agentic chart acquisition — drives a charting provider to produce a sanitized
`ChartImage` for a ticker, which the VLM package then interprets.

## What's here

- **`agent.ts`** — the `ChartAgent` interface (`acquire(ticker) → ChartImage`) and
  `ChartAcquisitionError` with typed failure reasons (`not-authenticated`,
  `chart-not-found`, `unknown-ticker`, `timeout`).
- **`pacing.ts`** — human-like inter-action delays and a `RateLimiter`. Both pure and
  injectable (clock/RNG), so they unit-test without sleeping. This is politeness and
  rate-limiting, not detection evasion.
- **`session.ts`** — resolves the persistent browser-profile directory.
- **`login.ts`** — the one-time interactive sign-in (see below).
- **`profiles/tradingview.ts`** — the TradingView profile: deep-link URL, the `3M`
  range token, and the three indicator specs, all wired to `INDICATOR_PARAMS` /
  `CHART_WINDOW` from `shared` so they can't drift.
- **`fake.ts`** — `FakeChartAgent` for testing the pipeline without a browser.

## Authentication: sign in once, by hand

The agent **never handles a password and never automates a sign-in flow.** You sign in
yourself in a real browser window; the session is persisted and reused:

```bash
npm run login -w @stock-indicator-dailies/agent
```

A headed Chromium opens at TradingView. **Sign in with email + password**, then wait for
the terminal to print `✅ SIGNED IN` before closing the window.

> ⚠️ **Google SSO does not work here.** Google blocks OAuth in any automation-controlled
> browser ("this browser or app may not be secure") — it's blocking the *browser*, not
> the fact that you're typing by hand, so there's no way around it short of evading
> Google's detection, which we don't do. If your TradingView account was created via
> Google, add a password to it (profile → account settings, or the "Forgot password?"
> flow against your Google address) and use that here.

Verify the session at any time:

```bash
npm run status -w @stock-indicator-dailies/agent
```

A rendered chart does **not** mean you're signed in — TradingView serves charts to
anonymous visitors, which is why auth is detected via the session cookie
(`src/auth.ts`) rather than by looking at the page.

The session is saved to `.agent-profile/` (gitignored). **Treat that directory as a
secret** — it grants access to the signed-in account. Re-run the login whenever the
session expires; the agent surfaces `not-authenticated` rather than silently capturing a
logged-out page.

## Image sanitization

Capture is scoped to the **chart element only** — never a full-page screenshot — so
account chrome (balances, watchlists, account numbers) never enters the image. This is
the PRD's regional-cropping requirement, enforced by construction rather than by
post-processing.

## ⚠️ Never use TradingView's date-range tabs

The `1D / 5D / 1M / 3M / 6M …` buttons at the bottom of the chart are **range +
interval presets**, not range selectors. Their own aria-labels give it away:

| Tab | Actual behavior |
|---|---|
| `1M` | 1 month in **30 minute** intervals |
| `3M` | 3 months in **1 hour** intervals |
| `6M` | 6 months in **2 hours** intervals |

Clicking `3M` silently switches the chart to **hourly bars**, so a "10-day SMA"
becomes a 10-*hour* SMA and MACD 8/17/9 runs on hourly closes. The resulting
image looks completely normal — nothing in the chart says the timeframe is wrong.

The interval is therefore pinned via the URL (`&interval=D`) and **verified after
load** (`src/interval.ts`); a mismatch fails with `wrong-interval` rather than
capturing a misleading chart.

**Known gap:** the visible window is whatever the saved layout uses (~6 months),
not exactly 3. Every range control that would narrow it also forces an intraday
interval. The indicator math is unaffected — only how much history is visible.

## Provider selectors are volatile

The selectors in `profiles/tradingview.ts` target a third-party DOM that changes. When
they break, the driver fails with `chart-not-found` instead of capturing the wrong
region. Expect to re-verify them periodically.

## Develop

```bash
npm test -w @stock-indicator-dailies/agent
npm run typecheck
```
