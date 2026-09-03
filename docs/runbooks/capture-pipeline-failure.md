# Runbook: capture pipeline failure

Triggered by the Datadog monitor **"Stock Indicator Dailies - capture pipeline
failure on {{host.name}}"**, backed by the custom Agent check
`stock_indicator_failures` (service check `stock_indicator.capture_pipeline`).
The check polls Supabase's `capture_failures` table for rows in the last 15
minutes; this fires when there's at least one.

`capture_failures` is written by `logFailure()` in `apps/api/src/cache.ts`,
called from exactly one place — `runExclusive()` in `apps/api/src/pipeline.ts`
— regardless of what *triggered* the run: the 7am ET scheduled watchlist
sweep (`apps/api/src/scheduler.ts`) and an ad-hoc lookup (`POST
/api/daily/start`, or a watchlist ticker page's retry-on-load) both go
through the same `runPipeline()` → `runExclusive()` path. One table, one
alert, covers both.

> **Scope note:** as of this writing, this monitor only fires while a local
> Datadog Agent is running on a laptop (see "Is this monitoring production?"
> below) — it does not yet run continuously against the live site.

## 1. Look at the actual failure(s)

Query Supabase directly — this is always the fastest way to see what
actually happened, faster than digging through Render logs:

```sql
select ticker, stage, reason, errors, occurred_at
from capture_failures
order by occurred_at desc
limit 10;
```

Or via the REST API:

```bash
curl -s "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/capture_failures?select=ticker,stage,reason,errors,occurred_at&order=occurred_at.desc&limit=10" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
```

`stage` is `'capture'` or `'analysis'`; `reason` narrows it further. Use the
table below to decide what to do next.

## 2. What each `stage`/`reason` means

### `stage: capture` (packages/agent/src/agent.ts's `ChartAcquisitionFailure`)

| `reason` | Meaning | Action |
|---|---|---|
| `wrong-interval` | Chart loaded on the wrong bar interval (e.g. monthly instead of daily) | Usually transient (a rendering race — see PR fixing the interval-header regex false positive). Retry; if it recurs for the *same* ticker repeatedly, check `packages/agent/src/interval.ts` for a new false-positive pattern. |
| `studies-not-rendered` | Indicator legend shows real values, but the plotted lines never painted | Should already be caught pre-report by `packages/agent/src/pane-paint.ts`'s pixel check — if this reason is showing up, that check itself may be failing to trigger; worth a look. |
| `chart-not-found` | Expected chart/study elements missing from the DOM | TradingView's layout may have changed, or the saved chart layout lost a study. Manually check the account's saved "Rule 1" layout in TradingView. |
| `popup-blocking` | A promo pop-up was still covering the chart after retries | Should be rare — both DOM-selector (`hasVisiblePopup`) and pixel-based (`looksLikePopupOverlay`, `hasForeignOverlayOverChart`) checks exist. If recurring, capture the failure's attached image and compare against known popup patterns in `packages/agent/src/tradingview-agent.ts`. |
| `timeout` | Page load, screenshot, or study-render deadline exceeded | Usually a slow TradingView response or host resource pressure. Check Render's Metrics tab for CPU/memory at the failure timestamp. |
| `not-authenticated` | The saved TradingView session expired | Needs a manual re-login via `npm run login -w @stock-indicator-dailies/agent`; not something a retry fixes on its own. |
| `unknown-ticker` | Declared in the type, but **never actually thrown** anywhere in the codebase as of this writing | If you see this reason, something changed — search `tradingview-agent.ts` for where it'd need to be added; a real "ticker doesn't exist" case currently surfaces as `wrong-interval` instead (a known, flagged gap). |
| `unknown` | An unclassified throw from within `runDaily`'s own capture try/catch | Read `errors` for the raw underlying message — likely a raw Playwright/network error. |
| `unexpected-exception` | Something threw from *outside* `runDaily`'s own coverage — e.g. `ensureInitialized()` in `pipeline.ts` | This is the rarer, more serious case: it means a bug outside the well-trodden capture/analyze paths. Read `errors` closely. |

### `stage: analysis` (packages/daily/src/run-daily.ts)

| `reason` | Meaning | Action |
|---|---|---|
| `provider-unavailable` | Claude's API looked like an outage (`isOutageError`) | Check [status.claude.com](https://status.claude.com/) or [Downdetector](https://downdetector.com/status/claude-ai/). Usually resolves on its own; no action needed beyond waiting. |
| `provider-error` | A non-outage Claude API error (auth, malformed request, etc.) | Check `errors` for the raw message; likely needs a code fix if it's not transient. |
| `invalid-verdict` | Claude responded, but the JSON didn't parse/validate against the expected schema | Check `errors`; may indicate the model's output format drifted — compare against `packages/vlm/src/prompt.ts`'s expected shape. |

## 3. Retry

No dedicated "retry" button/endpoint exists — simply re-triggering a run *is*
the retry mechanism:

- **A watchlisted ticker:** visit `/watchlist/<TICKER>` on the site. Loading
  that page calls `GET /watchlist/:ticker/report`, which fires a fresh
  `runPipeline()` call if there's no fresh cache and the last attempt was
  more than 30s ago (`canAttempt()` in `pipeline.ts`).
- **Any ticker, via API directly:**
  ```bash
  curl -X POST "$PIPELINE_API_URL/api/daily/start" \
    -H "Content-Type: application/json" \
    -d '{"ticker":"<TICKER>"}'
  ```

## 4. If nothing shows up in `capture_failures` at all

If the monitor fired but the table is empty for the alert window, that's
its own bug — check the Agent check's own output first:

```bash
sudo /opt/datadog-agent/bin/agent/agent check stock_indicator_failures
```

If the check itself errors (service check `UNKNOWN`, not `CRITICAL`), it
couldn't reach Supabase — check network connectivity and that
`supabase_url`/`supabase_key` in
`/opt/datadog-agent/etc/conf.d/stock_indicator_failures.d/conf.yaml` are
still correct.

## Is this monitoring production?

**The data is real; the alerting isn't fully production yet.** `capture_failures`
is written by the actual deployed app (Render + Vercel) regardless of what
triggers a run — but the thing that *notices* a new row and fires this
alert (the Datadog Agent + custom check) currently only runs on a laptop.
If that machine is off or the Agent isn't running, a real production
failure won't page anyone.

See "Getting this into production" (estimate written up separately) for
what it'd take to make this always-on.
