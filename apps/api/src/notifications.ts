import {
  INDICATOR_KEYS,
  recomputeReport,
  resolveDualOverall,
  type ChartImage,
  type IndicatorKey,
  type Signal,
} from '@stock-indicator-dailies/shared';

import { getCachedReport } from './cache.ts';
import { sendEmail, type EmailAttachment } from './email.ts';
import { getUsersWithEmailOnSignal } from './notificationPrefs.ts';
import { getSupabaseClient } from './supabaseClient.ts';
import { getUserSignalStates, setUserSignalStates } from './userSignalState.ts';
import { getWatchlist } from './watchlist.ts';

export interface SignalEvent {
  ticker: string;
  /** null when this is the ticker's first-ever evaluation for this user
   * (no prior state on record), not merely "was HOLD." */
  from: Signal | null;
  to: 'BUY' | 'SELL';
}

/** A SignalEvent enriched with the underlying computed (deterministic) and
 * AI reads that produced `to` via resolveDualOverall, so the digest email
 * can call out when the two disagreed and show both readings; kept
 * separate from SignalEvent/detectSignalEvents so the pure transition
 * comparison stays exactly what it was (ticker + overall in, overall out),
 * with the enrichment only happening where it's actually consumed. */
export interface DigestEvent extends SignalEvent {
  computed: Signal | null;
  ai: Signal;
  /** The VLM's per-indicator rationale, SMA/MACD/Slow Stochastic order
   * (matching the rest of the app), for whichever indicators it actually
   * provided one; empty when the model didn't return any. */
  readings: Array<{ indicator: IndicatorKey; rationale: string }>;
  /** The chart screenshot behind this read, embedded inline in the email. */
  image: ChartImage;
}

/**
 * Pure comparison: which tickers just became a new BUY/SELL event for this
 * user, i.e. `current` says BUY or SELL and it differs from `prior`. A
 * ticker with no prior state counts as a change too (its first-ever
 * evaluation firing BUY/SELL is real, actionable information, worth
 * surfacing rather than treated as silent baseline), and a ticker settled
 * on HOLD, or unchanged from BUY/SELL to the same BUY/SELL, produces
 * nothing. Exported for direct unit testing.
 */
export function detectSignalEvents(prior: Map<string, Signal>, current: Map<string, Signal>): SignalEvent[] {
  const events: SignalEvent[] = [];
  for (const [ticker, to] of current) {
    if (to !== 'BUY' && to !== 'SELL') continue;
    const from = prior.get(ticker) ?? null;
    if (from === to) continue;
    events.push({ ticker, from, to });
  }
  return events.sort((a, b) => a.ticker.localeCompare(b.ticker));
}

/** The app's own URL, for linking each ticker in the digest back to its
 * page. Omitted (tickers listed as plain text) when unset, rather than
 * guessing at a deployment URL that could go stale. */
function tickerUrl(ticker: string): string | null {
  const base = process.env.APP_URL;
  return base ? `${base.replace(/\/$/, '')}/watchlist/${ticker}` : null;
}

/** Whether the computed (deterministic) and AI reads actually disagreed
 * for this event. `computed === null` (the data fetch failed that day)
 * means there's nothing to compare against, not a conflict. */
function hasConflict(e: DigestEvent): boolean {
  return e.computed !== null && e.computed !== e.ai;
}

function changeLabel(e: DigestEvent): string {
  return e.from ? `${e.from} → ${e.to}` : e.to;
}

const INDICATOR_LABELS: Record<IndicatorKey, string> = {
  sma: 'SMA',
  macd: 'MACD',
  slowStochastic: 'Slow Stochastic',
};

function buildDigestEmail(
  to: string,
  events: DigestEvent[],
): { to: string; subject: string; html: string; text: string; headers?: Record<string, string>; attachments: EmailAttachment[] } {
  const buys = events.filter((e) => e.to === 'BUY');
  const sells = events.filter((e) => e.to === 'SELL');
  const subjectParts = [
    buys.length > 0 ? `${buys.length} BUY` : null,
    sells.length > 0 ? `${sells.length} SELL` : null,
  ].filter((p): p is string => p !== null);
  const subject = `Stock Analysis Dailies: ${subjectParts.join(', ')} signal${events.length > 1 ? 's' : ''}`;

  const htmlBlock = (e: DigestEvent) => {
    const url = tickerUrl(e.ticker);
    const label = url ? `<a href="${url}">${e.ticker}</a>` : e.ticker;
    const conflictNote = hasConflict(e)
      ? `<p style="color:#888;font-size:12px;margin:4px 0">Computed and AI reads disagreed: computed ${e.computed}, AI ${e.ai}.</p>`
      : '';
    const rationaleList =
      e.readings.length > 0
        ? `<ul style="font-size:13px;color:#555;margin:8px 0;padding-left:18px">${e.readings
            .map((r) => `<li><b>${INDICATOR_LABELS[r.indicator]}:</b> ${r.rationale}</li>`)
            .join('')}</ul>`
        : '';
    return `
      <div style="margin-bottom:24px;padding-bottom:16px;border-bottom:1px solid #ddd">
        <h3 style="margin:0 0 4px">${label}: ${changeLabel(e)}</h3>
        ${conflictNote}
        ${rationaleList}
        <img src="cid:chart-${e.ticker}" alt="${e.ticker} chart" style="max-width:600px;width:100%;border:1px solid #ddd;border-radius:4px">
      </div>
    `;
  };

  const textBlock = (e: DigestEvent) => {
    const conflictNote = hasConflict(e) ? ` (computed and AI reads disagreed: computed ${e.computed}, AI ${e.ai})` : '';
    const rationaleLines = e.readings.map((r) => `    ${INDICATOR_LABELS[r.indicator]}: ${r.rationale}`);
    return [`- ${e.ticker}: ${changeLabel(e)}${conflictNote}`, ...rationaleLines, '    (chart image attached)'].join('\n');
  };

  const html = `
    <p>Your watchlist has ${events.length} new signal${events.length > 1 ? 's' : ''}:</p>
    ${events.map(htmlBlock).join('')}
    <p style="color:#888;font-size:12px">Not financial advice. A data-acquisition and reporting tool; every decision is yours to make.</p>
  `.trim();

  const text = [
    `Your watchlist has ${events.length} new signal${events.length > 1 ? 's' : ''}:`,
    ...events.map(textBlock),
    '',
    'Not financial advice. A data-acquisition and reporting tool; every decision is yours to make.',
  ].join('\n');

  // Recurring/digest-style mail without a List-Unsubscribe header is a
  // real deliverability signal Gmail and others weigh toward spam. This
  // points at the same page the on/off toggle lives on rather than a true
  // one-click unsubscribe endpoint (which would need its own unauthenticated
  // route); List-Unsubscribe-Post is deliberately not set alongside it,
  // since that header promises one-click semantics this link doesn't provide.
  const base = process.env.APP_URL;
  const headers = base ? { 'List-Unsubscribe': `<${base.replace(/\/$/, '')}/watchlist>` } : undefined;

  const attachments: EmailAttachment[] = events.map((e) => ({
    filename: `${e.ticker}.png`,
    content: e.image.base64,
    contentId: `chart-${e.ticker}`,
  }));

  return { to, subject, html, text, headers, attachments };
}

/** The Supabase Auth email for `userId`, or null on any failure (a
 * missing/unreachable email just means that user's digest is silently
 * skipped this run, not a crash of the whole sweep). */
async function getUserEmail(userId: string): Promise<string | null> {
  const db = getSupabaseClient();
  if (!db) return null;

  try {
    const { data, error } = await db.auth.admin.getUserById(userId);
    if (error || !data.user?.email) return null;
    return data.user.email;
  } catch {
    return null;
  }
}

/** Evaluates one user's whole watchlist (their own sensitivity settings
 * applied, same value their dashboard shows) against what was last on
 * record, and emails a single consolidated digest if anything transitioned
 * into or between BUY/SELL. Always persists the freshly-evaluated state,
 * whether or not anything fired, so tomorrow's comparison is against
 * today's real value rather than drifting stale. */
async function checkAndNotifyUser(userId: string): Promise<void> {
  const entries = await getWatchlist(userId);
  if (entries.length === 0) return;

  const priorStates = await getUserSignalStates(userId);
  const currentStates = new Map<string, Signal>();
  // The individual reads behind each ticker's overall, kept only for the
  // duration of this run (not persisted: user_signal_state only needs the
  // resolved overall for tomorrow's comparison), so a firing event can
  // report whether computed and AI actually agreed, and carry the AI's own
  // rationale + chart image into the digest.
  const currentReads = new Map<
    string,
    { computed: Signal | null; ai: Signal; readings: Array<{ indicator: IndicatorKey; rationale: string }>; image: ChartImage }
  >();

  for (const entry of entries) {
    // Fresh-only (not the stale-tolerant getCachedReportDetail): the sweep
    // that precedes this just force-refreshed every watchlisted ticker, so
    // a miss here means that specific capture failed today. Skip it rather
    // than notify off yesterday's (or no) data; it's re-evaluated
    // naturally on the next successful capture.
    const cached = await getCachedReport(entry.ticker);
    if (!cached) continue;

    const report = recomputeReport(cached, entry.settings ?? {});
    const computed = report.deterministic?.signal ?? null;
    const ai = report.verdict.signal;
    const overall = resolveDualOverall(computed, ai);
    // resolveDualOverall only returns null when the AI signal itself is
    // null, which never happens on a completed report (the type just
    // doesn't know that); skip defensively rather than assert it away.
    if (overall === null) continue;
    currentStates.set(entry.ticker, overall);

    const byKey = new Map(report.verdict.readings.map((r) => [r.indicator, r]));
    const readings = INDICATOR_KEYS.flatMap((key) => {
      const rationale = byKey.get(key)?.rationale;
      return rationale ? [{ indicator: key, rationale }] : [];
    });
    currentReads.set(entry.ticker, { computed, ai, readings, image: report.image });
  }

  await setUserSignalStates(userId, currentStates);

  const transitions = detectSignalEvents(priorStates, currentStates);
  if (transitions.length === 0) return;

  const events: DigestEvent[] = transitions.map((t) => ({ ...t, ...currentReads.get(t.ticker)! }));

  const email = await getUserEmail(userId);
  if (!email) {
    console.warn(`[notifications] user ${userId}: ${events.length} event(s) but no email on record; skipping`);
    return;
  }

  const sent = await sendEmail(buildDigestEmail(email, events));
  console.log(`[notifications] user ${userId}: ${events.length} event(s), email ${sent ? 'sent' : 'failed'}`);
}

/**
 * Checks every user who's opted into watchlist email alerts and sends each
 * one a consolidated digest if anything changed. Meant to run once, right
 * after the daily capture sweep completes (see scheduler.ts) so it's
 * evaluating today's fresh reads, not yesterday's. Sequential and
 * per-user-isolated: one user's failure (no email on record, a Resend
 * hiccup) must never block evaluating the rest.
 */
export async function sendWatchlistSignalEmails(): Promise<void> {
  const userIds = await getUsersWithEmailOnSignal();
  if (userIds.length === 0) return;

  console.log(`[notifications] checking ${userIds.length} user(s) with email alerts enabled`);
  for (const userId of userIds) {
    try {
      await checkAndNotifyUser(userId);
    } catch (err) {
      console.error(`[notifications] user ${userId}: threw`, err);
    }
  }
}
