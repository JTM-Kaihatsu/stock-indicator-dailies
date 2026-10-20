import { checkedRecently, isFresh } from './advisorCache.ts';

/** Why a full (stage 1 + stage 2) regeneration is happening. Drives whether
 * the cached stage-1 research can be reused (see canReuseResearch); kept
 * separate from the cheap-check cadence on purpose: the cheap check's 24h
 * window decides how often we *look* for news, while the research window
 * decides whether a regeneration actually *re-researches*. */
export type RegenReason = 'no-cache' | 'earnings-passed' | 'stale-no-earnings-date' | 'material-news';

export type RefreshDecision =
  | { action: 'regenerate'; reason: 'no-cache' | 'earnings-passed' | 'stale-no-earnings-date' }
  | { action: 'quick-check' }
  | { action: 'serve-cached' };

export interface CachedSuggestionState {
  nextEarningsDate: string | null;
  retrievedAt: string;
  lastCheckedAt: string | null;
}

/** An earnings date is "current" for the whole calendar day (UTC) it
 * happens, not the instant it starts. */
export function isPastEarningsDate(nextEarningsDate: string | null, now: Date): boolean {
  if (!nextEarningsDate) return false;
  return now.getTime() > new Date(`${nextEarningsDate}T23:59:59Z`).getTime();
}

/** First-level decision for a request against an existing (or missing)
 * cached suggestion; see startAdvisorJob's doc comment for the reasoning. */
export function decideRefresh(cached: CachedSuggestionState | null, now: Date): RefreshDecision {
  if (!cached) return { action: 'regenerate', reason: 'no-cache' };
  if (isPastEarningsDate(cached.nextEarningsDate, now)) return { action: 'regenerate', reason: 'earnings-passed' };
  if (cached.nextEarningsDate === null && !isFresh(cached.retrievedAt, now.getTime())) {
    return { action: 'regenerate', reason: 'stale-no-earnings-date' };
  }
  return checkedRecently(cached.lastCheckedAt, now.getTime()) ? { action: 'serve-cached' } : { action: 'quick-check' };
}

/** Whether the cached stage-1 research may be reused for a regeneration,
 * or must be redone. The old rule (reuse anything under a week old) meant
 * the very events that trigger a regeneration were swallowed: news found
 * by the cheap check, or an earnings date passing, re-scored the same
 * pre-event research and stamped it as freshly updated. Reuse is now only
 * allowed when the research is already newer than the event itself, which
 * still lets the three risk tolerances share one research pass:
 *
 * - no-cache / stale-no-earnings-date: nothing event-driven happened, so
 *   the plain weekly freshness window is the right test (a sibling
 *   tolerance may just have researched).
 * - earnings-passed: only if the research was retrieved after that
 *   earnings day ended, i.e. a sibling already re-researched post-earnings.
 * - material-news: only if the research was retrieved within the cheap-check
 *   window (a day), i.e. as recent as the check that flagged the news.
 *
 * `earningsDate` is the suggestion's own known date (needed for
 * earnings-passed). */
export function canReuseResearch(
  research: { retrievedAt: string } | null,
  ctx: { reason: RegenReason; earningsDate: string | null },
  now: Date,
): boolean {
  if (!research) return false;
  const nowMs = now.getTime();
  switch (ctx.reason) {
    case 'no-cache':
    case 'stale-no-earnings-date':
      return isFresh(research.retrievedAt, nowMs);
    case 'earnings-passed': {
      if (!ctx.earningsDate) return false;
      const researchedAfterEarnings = new Date(research.retrievedAt).getTime() > new Date(`${ctx.earningsDate}T23:59:59Z`).getTime();
      return researchedAfterEarnings && isFresh(research.retrievedAt, nowMs);
    }
    case 'material-news':
      return checkedRecently(research.retrievedAt, nowMs);
  }
}
