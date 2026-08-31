import { getAllDistinctWatchlistedTickers } from './watchlist.ts';
import { runPipeline } from './pipeline.ts';

/** Product decision, not deployment config: "7am ET" doesn't vary by
 * environment, so it's a constant here rather than an env var. */
const WATCHLIST_TZ = 'America/New_York';
const RUN_HOUR_ET = 7;

interface WallClockParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function wallClockPartsInZone(date: Date, timeZone: string): WallClockParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  // hour12:false renders midnight as "24" in some engines; normalize.
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour') % 24, minute: get('minute'), second: get('second') };
}

/**
 * The UTC instant whose wall-clock reading in `timeZone` is exactly the
 * given date/time. A timezone's UTC offset is piecewise constant (it only
 * changes at a DST transition), so correcting a first guess by the
 * difference between its actual and wanted wall-clock reading converges in
 * one step; a second iteration is cheap margin in case the correction
 * itself crosses a transition.
 */
function zonedWallClockToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
): Date {
  const wantedAsEpoch = Date.UTC(year, month - 1, day, hour, minute, second);
  let guess = new Date(wantedAsEpoch);
  for (let i = 0; i < 2; i++) {
    const actual = wallClockPartsInZone(guess, timeZone);
    const actualAsEpoch = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    const diff = wantedAsEpoch - actualAsEpoch;
    if (diff === 0) break;
    guess = new Date(guess.getTime() + diff);
  }
  return guess;
}

/** Whether the given (year, month, day) calendar date — as read from
 * `wallClockPartsInZone`, so already the *local* ET date, not a UTC one —
 * falls on a Saturday or Sunday. `Date.UTC` with those same Y/M/D numbers is
 * a pure calendar computation (which weekday does this date fall on), not a
 * timezone conversion; using UTC here avoids the local *system* timezone
 * `new Date(y, m, d).getDay()` would otherwise depend on. */
function isWeekend(year: number, month: number, day: number): boolean {
  const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay(); // 0=Sun .. 6=Sat
  return dayOfWeek === 0 || dayOfWeek === 6;
}

/**
 * Next America/New_York `hourET`:00:00 local time, strictly after `now`, on
 * a weekday. Markets are closed Saturday and Sunday — no new trading bar
 * exists to justify a run, so a would-be weekend occurrence is skipped
 * forward to the next weekday's `hourET`:00:00 instead of firing at all.
 *
 * DST-correct: never does fixed-offset UTC arithmetic. To advance a day it
 * steps forward by a real 24h from the current candidate instant and then
 * re-reads *that* instant's ET calendar date (robust to a DST day being 23
 * or 25 wall-clock hours long, since only the *date* from that reading is
 * used; the exact time is then re-derived for that date via
 * zonedWallClockToUtc, which self-corrects for whatever offset applies that
 * day) — same technique whether advancing past "today's time already
 * passed" or past a weekend, so the loop below handles both with one path.
 */
export function computeNextRunAt(now: Date, hourET: number = RUN_HOUR_ET): Date {
  let parts = wallClockPartsInZone(now, WATCHLIST_TZ);
  let candidate = zonedWallClockToUtc(parts.year, parts.month, parts.day, hourET, 0, 0, WATCHLIST_TZ);

  // Bounded, not "while true": a weekend is at most 2 days, plus at most 1
  // more for "today's time already passed" — 7 iterations is generous
  // headroom, not a tuned figure, purely so a logic bug here fails loudly
  // (an infinite loop) rather than never.
  for (let i = 0; i < 7; i++) {
    if (candidate.getTime() > now.getTime() && !isWeekend(parts.year, parts.month, parts.day)) {
      return candidate;
    }
    const roughlyNextDay = new Date(candidate.getTime() + 24 * 60 * 60 * 1000);
    parts = wallClockPartsInZone(roughlyNextDay, WATCHLIST_TZ);
    candidate = zonedWallClockToUtc(parts.year, parts.month, parts.day, hourET, 0, 0, WATCHLIST_TZ);
  }
  throw new Error('computeNextRunAt: failed to converge on a weekday within 7 days; this indicates a bug');
}

/**
 * Sweeps every distinct watchlisted ticker (across all users) through
 * runPipeline. Sequential, not Promise.all: the pipeline's own queue
 * already serializes on the single TradingView browser session, so
 * concurrent calls here would just pile up in that queue rather than run
 * any faster, and sequential keeps "how far did today's run get" simple to
 * log if something goes wrong partway through. A ticker whose chart_cache
 * entry is already fresh (e.g. someone ran it ad hoc earlier that day)
 * short-circuits for free inside runPipeline.
 */
export async function runDailyWatchlistJob(): Promise<void> {
  const tickers = await getAllDistinctWatchlistedTickers();
  console.log(`[watchlist scheduler] starting daily sweep of ${tickers.length} ticker(s)`);
  for (const ticker of tickers) {
    try {
      const result = await runPipeline(ticker);
      console.log(`[watchlist scheduler] ${ticker}: ${result.ok ? 'ok' : `failed (${result.stage}/${result.reason})`}`);
    } catch (err) {
      console.error(`[watchlist scheduler] ${ticker}: threw`, err);
    }
  }
  console.log('[watchlist scheduler] daily sweep complete');
}

/** Starts the recurring scheduler: a setTimeout to the next occurrence,
 * rescheduling from a fresh `now` after every fire (rather than a fixed
 * 24h repeating interval) so drift or a missed tick can't accumulate. */
export function startDailyScheduler(onTick: () => Promise<void>): { stop: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  function scheduleNext() {
    if (stopped) return;
    const next = computeNextRunAt(new Date());
    const delayMs = next.getTime() - Date.now();
    console.log(`[watchlist scheduler] next run at ${next.toISOString()} (in ${Math.round(delayMs / 60000)}min)`);
    timer = setTimeout(async () => {
      try {
        await onTick();
      } catch (err) {
        console.error('[watchlist scheduler] tick threw', err);
      }
      scheduleNext();
    }, delayMs);
  }

  scheduleNext();
  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
