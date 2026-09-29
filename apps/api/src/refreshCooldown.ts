import { getCachedReportMeta, getLatestFailure } from './cache.ts';
import { marketHasNotReopenedSince, nextMarketOpenAfter } from './marketHours.ts';

/**
 * How long a manually-refreshed watchlisted ticker stays un-refreshable
 * for. A product rule about how often a person should be hand-triggering a
 * *daily* read, deliberately separate from the pipeline's own 30s in-memory
 * anti-hammer guard (`canAttempt`): this one is an hour and is derived from
 * persistent state, so it survives a deploy/restart and is consistent
 * across a user's devices.
 */
export const REFRESH_COOLDOWN_MS = 60 * 60 * 1000;

/**
 * When a manual refresh becomes available again, as an ISO string, or
 * `null` when it's available right now (including when nothing has ever
 * been attempted for this ticker).
 *
 * "Last attempt" is the later of the last successful capture
 * (`chart_cache.retrieved_at`) and the last logged failure
 * (`capture_failures.occurred_at`) — a failed refresh still costs a real
 * capture, so it starts the cooldown too.
 */
export function computeRefreshAvailableAt(
  lastSuccessAt: string | null,
  lastFailureAt: string | null,
  now: number = Date.now(),
  cooldownMs: number = REFRESH_COOLDOWN_MS,
): string | null {
  const attempts = [lastSuccessAt, lastFailureAt]
    .filter((t): t is string => t !== null && t !== undefined)
    .map((t) => new Date(t).getTime())
    .filter((t) => Number.isFinite(t));
  if (attempts.length === 0) return null;

  const availableAt = Math.max(...attempts) + cooldownMs;
  return availableAt > now ? new Date(availableAt).toISOString() : null;
}

/** The later of two "available at" ISO timestamps, either of which may be
 * `null` (meaning "no restriction from that particular check"); `null`
 * only when neither restricts anything. Used to combine the plain 1h
 * cooldown with the market-hours guardrail below -- a refresh stays
 * blocked until BOTH have cleared. Exported for direct testing of the
 * combining logic itself, independent of checkRefreshCooldown's own DB
 * reads. */
export function laterOf(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return new Date(a).getTime() > new Date(b).getTime() ? a : b;
}

/** Whether the market hasn't reopened since `ticker`'s last successful
 * refresh, and if so, when it will (see marketHours.ts's
 * marketHasNotReopenedSince for the exact rule and worked examples).
 * `null` when the guardrail doesn't apply: no successful capture yet, or
 * the last one landed during a live session. Deliberately keyed off the
 * last *successful* capture only (not the later-of-success-or-failure the
 * plain cooldown above uses): this check is about whether new market data
 * could exist, which a failed attempt has no bearing on. */
export function marketGuardrailAvailableAt(lastSuccessAt: string | null, now: Date): string | null {
  if (!lastSuccessAt) return null;
  const lastRefresh = new Date(lastSuccessAt);
  if (Number.isNaN(lastRefresh.getTime())) return null;
  if (!marketHasNotReopenedSince(lastRefresh, now)) return null;
  return nextMarketOpenAfter(lastRefresh).toISOString();
}

/**
 * Looks up `ticker`'s own last-attempt timestamps and applies both the
 * plain 1h cooldown (computeRefreshAvailableAt) and the market-hours
 * guardrail (marketGuardrailAvailableAt) -- a refresh whose last success
 * already landed after a close is blocked until the market reopens,
 * weekends included, regardless of how long it's been. The one place both
 * the watchlist refresh route and the ad-hoc daily refresh route should
 * call, so their enforcement can't drift apart. Ticker-scoped only, same
 * as both checks themselves (chart_cache/capture_failures/market hours
 * have no notion of "which user"), so it's equally correct for an
 * authenticated, watchlist-membership-checked caller and an anonymous,
 * ad-hoc one. `now` is overridable for tests; real callers leave it as the
 * actual current time.
 */
export async function checkRefreshCooldown(ticker: string, now: Date = new Date()): Promise<string | null> {
  const meta = await getCachedReportMeta(ticker);
  const failure = await getLatestFailure(ticker);
  const cooldownAvailableAt = computeRefreshAvailableAt(meta?.retrievedAt ?? null, failure?.occurredAt ?? null, now.getTime());
  const marketAvailableAt = marketGuardrailAvailableAt(meta?.retrievedAt ?? null, now);
  return laterOf(cooldownAvailableAt, marketAvailableAt);
}

/**
 * The `refreshAvailableAt` to show proactively right after kicking off a
 * refresh, before its own capture has actually landed in chart_cache and
 * become visible to checkRefreshCooldown. Combines the plain 1h cooldown
 * from right now with the market-hours guardrail as if this refresh's own
 * capture completes at `now` (it will, within moments) -- so a refresh
 * kicked off after a close shows the real "tomorrow morning" (or "Monday
 * morning") wait immediately, rather than a flat "+1h" that the very next
 * real checkRefreshCooldown call would immediately contradict.
 */
export function proactiveRefreshAvailableAt(now: Date = new Date()): string {
  const cooldownAvailableAt = new Date(now.getTime() + REFRESH_COOLDOWN_MS).toISOString();
  const marketAvailableAt = marketGuardrailAvailableAt(now.toISOString(), now);
  return laterOf(cooldownAvailableAt, marketAvailableAt)!;
}
