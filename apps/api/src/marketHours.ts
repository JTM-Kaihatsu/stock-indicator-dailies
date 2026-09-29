/**
 * Regular US equity market hours (9:30am - 4:00pm America/New_York, weekdays
 * only), for the manual-refresh guardrail in refreshCooldown.ts: a refresh
 * shouldn't do anything if the market hasn't opened since the last one
 * already landed after a close, since no new trading data could exist yet.
 *
 * Deliberately doesn't model holidays (a closed weekday, e.g. Thanksgiving)
 * -- out of scope for now by explicit product decision, not an oversight.
 * On a market holiday this degrades to treating it like a normal trading
 * day: a refresh attempted then won't be blocked by this guardrail (it'll
 * just find nothing new, same as any other unforced check would), not a
 * false positive block.
 */
import { isWeekend, nextWeekdayTimeAfter, wallClockPartsInZone, zonedWallClockToUtc } from './zonedTime.ts';

const MARKET_TZ = 'America/New_York';
const OPEN_HOUR = 9;
const OPEN_MINUTE = 30;
const CLOSE_HOUR = 16;
const CLOSE_MINUTE = 0;

/** Whether `t` falls within a regular trading session: a weekday, 9:30am up
 * to (not including) 4:00pm ET. The close boundary is exclusive -- the
 * session has already ended exactly at 4:00pm, not a moment after. */
export function isMarketOpenAt(t: Date): boolean {
  const parts = wallClockPartsInZone(t, MARKET_TZ);
  if (isWeekend(parts.year, parts.month, parts.day)) return false;
  const openAt = zonedWallClockToUtc(parts.year, parts.month, parts.day, OPEN_HOUR, OPEN_MINUTE, 0, MARKET_TZ);
  const closeAt = zonedWallClockToUtc(parts.year, parts.month, parts.day, CLOSE_HOUR, CLOSE_MINUTE, 0, MARKET_TZ);
  return t.getTime() >= openAt.getTime() && t.getTime() < closeAt.getTime();
}

/** The next market-open instant (9:30am ET on a weekday) strictly after
 * `t`, skipping Saturday/Sunday -- e.g. Friday evening or any time over the
 * weekend both resolve to the following Monday's open. */
export function nextMarketOpenAfter(t: Date): Date {
  return nextWeekdayTimeAfter(t, OPEN_HOUR, OPEN_MINUTE, MARKET_TZ);
}

/**
 * Whether a manual refresh attempted at `now` would be pointless because
 * the market hasn't opened since `lastRefreshAt` already landed after a
 * close: no new trading data could exist yet, so there's nothing for a
 * refresh to actually pick up.
 *
 * Only applies when `lastRefreshAt` itself happened outside market hours
 * (evenings, nights, weekends, or before that day's own open) -- a refresh
 * that landed during a live session is never blocked by this, only by the
 * ordinary 1h cooldown (see refreshCooldown.ts). Concretely: a refresh at
 * Monday 6pm blocks further attempts until Tuesday 9:30am (so both Monday
 * 8pm and Tuesday 4am are blocked); a refresh at Friday 6pm blocks until
 * Monday 9:30am, covering the whole weekend.
 */
export function marketHasNotReopenedSince(lastRefreshAt: Date, now: Date): boolean {
  if (isMarketOpenAt(lastRefreshAt)) return false;
  return now.getTime() < nextMarketOpenAfter(lastRefreshAt).getTime();
}
