import { getAllDistinctWatchlistedTickers } from './watchlist.ts';
import { runPipeline } from './pipeline.ts';
import { getSupabaseClient } from './supabaseClient.ts';
import { sendWatchlistSignalEmails } from './notifications.ts';
import { isWeekend, nextWeekdayTimeAfter, wallClockPartsInZone, zonedWallClockToUtc } from './zonedTime.ts';

/** Product decision, not deployment config: "7am ET" doesn't vary by
 * environment, so it's a constant here rather than an env var. */
const WATCHLIST_TZ = 'America/New_York';
const RUN_HOUR_ET = 7;

/** Next America/New_York `hourET`:00:00 local time, strictly after `now`, on
 * a weekday. Markets are closed Saturday and Sunday — no new trading bar
 * exists to justify a run, so a would-be weekend occurrence is skipped
 * forward to the next weekday's `hourET`:00:00 instead of firing at all.
 * Thin wrapper over zonedTime.ts's general engine (shared with
 * marketHours.ts's open/close math), fixed to this scheduler's own zone and
 * :00 minute. */
export function computeNextRunAt(now: Date, hourET: number = RUN_HOUR_ET): Date {
  return nextWeekdayTimeAfter(now, hourET, 0, WATCHLIST_TZ);
}

/**
 * Atomically claims today's (America/New_York calendar date) sweep: an
 * insert that no-ops on conflict, so "has today already run" and "don't
 * double-fire" are the same check. Exists specifically because the
 * scheduler's normal trigger is an in-memory `setTimeout` recomputed fresh
 * on every process boot (see `startDailyScheduler` below) — a restart that
 * lands after today's fire time (a deploy, a host-level restart, the
 * service not having stayed continuously up through 7am ET) would
 * otherwise silently compute "next run = tomorrow" and skip today with no
 * trace at all, indistinguishable afterward from every ticker just
 * happening to fail. Returns `true` when Supabase isn't configured (same
 * degrade-to-permissive posture local dev already has everywhere else in
 * this codebase; there's nothing to persist the claim in), so this only
 * ever *adds* a guard, never blocks a run that would otherwise happen.
 */
async function claimTodayRun(): Promise<boolean> {
  const db = getSupabaseClient();
  if (!db) return true;

  const today = wallClockPartsInZone(new Date(), WATCHLIST_TZ);
  const runDate = `${today.year}-${String(today.month).padStart(2, '0')}-${String(today.day).padStart(2, '0')}`;
  try {
    const { error } = await db.from('scheduler_runs').insert({ run_date: runDate });
    // A unique-violation (23505) means today's row already exists — someone
    // else claimed it first, which is the expected, common case, not a
    // failure. Any other error degrades to "allow the run" (best-effort,
    // same posture as every other Supabase write in this codebase) rather
    // than silently blocking a sweep over an unrelated DB hiccup.
    if (error) return error.code === '23505' ? false : true;
    return true;
  } catch {
    return true;
  }
}

/**
 * Sweeps every distinct watchlisted ticker (across all users) through
 * runPipeline. Sequential, not Promise.all: the pipeline's own queue
 * already serializes on the single TradingView browser session, so
 * concurrent calls here would just pile up in that queue rather than run
 * any faster, and sequential keeps "how far did today's run get" simple to
 * log if something goes wrong partway through.
 *
 * Every ticker is forced (`runPipeline`'s `force` option): this sweep runs
 * at the same wall-clock time each morning, a few minutes before the
 * previous morning's writes cross the 24h cache window, so an unforced
 * sweep would find every ticker "still fresh" and skip itself entirely
 * every other day. Its whole purpose is a genuinely fresh read for the new
 * trading day, so it always captures.
 *
 * Returns whether it actually ran the sweep this call (`false` on the
 * duplicate-trigger skip above) so `runDailyWatchlistJobAndNotify` below
 * knows whether there's anything fresh to evaluate for email alerts.
 */
export async function runDailyWatchlistJob(): Promise<boolean> {
  if (!(await claimTodayRun())) {
    console.log('[watchlist scheduler] today has already run; skipping (this call was a duplicate trigger)');
    return false;
  }

  const tickers = await getAllDistinctWatchlistedTickers();
  console.log(`[watchlist scheduler] starting daily sweep of ${tickers.length} ticker(s)`);
  for (const ticker of tickers) {
    try {
      const result = await runPipeline(ticker, { force: true });
      console.log(`[watchlist scheduler] ${ticker}: ${result.ok ? 'ok' : `failed (${result.stage}/${result.reason})`}`);
    } catch (err) {
      console.error(`[watchlist scheduler] ${ticker}: threw`, err);
    }
  }
  console.log('[watchlist scheduler] daily sweep complete');
  return true;
}

/**
 * The real daily tick: the capture sweep above, then (only if it actually
 * ran, not a duplicate-trigger skip) the email-alert sweep, so alerts are
 * always evaluated against today's freshly-captured reads. This, not
 * `runDailyWatchlistJob` alone, is what the scheduler and the dev trigger
 * endpoint should call.
 */
export async function runDailyWatchlistJobAndNotify(): Promise<void> {
  const ran = await runDailyWatchlistJob();
  if (!ran) return;
  try {
    await sendWatchlistSignalEmails();
  } catch (err) {
    console.error('[watchlist scheduler] email-alert sweep threw', err);
  }
}

/** Whether today (America/New_York) is a weekday whose `hourET` has already
 * passed — i.e. whether a boot happening right now should catch up on a
 * possibly-missed run rather than only scheduling for the next occurrence
 * (which, by `computeNextRunAt`'s own strictly-future contract, would
 * otherwise always defer an already-passed today to tomorrow). */
export function isCatchUpDue(now: Date, hourET: number = RUN_HOUR_ET): boolean {
  const today = wallClockPartsInZone(now, WATCHLIST_TZ);
  if (isWeekend(today.year, today.month, today.day)) return false;
  const todayAtHour = zonedWallClockToUtc(today.year, today.month, today.day, hourET, 0, 0, WATCHLIST_TZ);
  return now.getTime() >= todayAtHour.getTime();
}

/**
 * Starts the recurring scheduler: a setTimeout to the next occurrence,
 * rescheduling from a fresh `now` after every fire (rather than a fixed
 * 24h repeating interval) so drift or a missed tick can't accumulate.
 *
 * Also checks on startup whether today's run is already overdue (see
 * `isCatchUpDue`) and fires immediately if so, before scheduling the next
 * occurrence as usual — `claimTodayRun` inside `onTick` (normally
 * `runDailyWatchlistJobAndNotify`) makes this safe to call speculatively: it's a
 * genuine catch-up if today never ran, and a harmless no-op (logged, not
 * silent) if it already did.
 */
export function startDailyScheduler(onTick: () => Promise<void>, hourET: number = RUN_HOUR_ET): { stop: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  function scheduleNext() {
    if (stopped) return;
    const next = computeNextRunAt(new Date(), hourET);
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

  if (isCatchUpDue(new Date(), hourET)) {
    console.log('[watchlist scheduler] startup catch-up check: today is already due; running now');
    onTick()
      .catch((err) => console.error('[watchlist scheduler] catch-up run threw', err))
      .finally(scheduleNext);
  } else {
    scheduleNext();
  }

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
