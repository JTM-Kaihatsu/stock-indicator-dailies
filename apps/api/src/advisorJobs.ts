import {
  AdvisorUpstreamError,
  AdvisorWallClockTimeoutError,
  checkForMaterialUpdates,
  researchCompany,
  scoreForRiskTolerance,
  type ResearchProposal,
  type RiskScoredProposal,
  type RiskTolerance,
} from '@stock-indicator-dailies/advisor';
import { yahooDataSource } from '@stock-indicator-dailies/indicators';
import { isOutageError } from '@stock-indicator-dailies/shared';

import { cacheResearch, cacheSuggestion, getCachedResearch, getCachedSuggestion, recordEarningsDate, recordQuickCheck } from './advisorCache.ts';
import { canReuseResearch, decideRefresh, type RegenReason } from './advisorRefreshPolicy.ts';
import { createJobStore } from './jobStore.ts';

/** RiskScoredProposal plus cache metadata the frontend needs to display
 * "last updated" and any pending quick-update note; flattened into one
 * object so the wire shape is uniform across the cached-peek and job-result
 * endpoints. */
export interface AdvisorResultWithMeta extends RiskScoredProposal {
  /** When this suggestion was last fully regenerated (not the last
   * quick-check, if any; see quickUpdateNote). What the UI shows as
   * "last updated". */
  retrievedAt: string;
  /** The appended note from a quick check that found nothing significant
   * since retrievedAt; null if none is pending. */
  quickUpdateNote: string | null;
}

export type AdvisorJobResult =
  | { ok: true; result: AdvisorResultWithMeta }
  | {
      ok: false;
      reason: string;
      /** Whether this looks like Claude being unavailable rather than a
       * one-off/programming error; drives the web UI's retry cooldown and
       * whether it points the user at Claude's status pages. */
      outage: boolean;
    };

// Same TTL/client-timeout headroom reasoning as jobs.ts; the advisor isn't
// subject to the daily pipeline's browser-session queue, but research can
// still legitimately run long (multiple web_search turns).
const store = createJobStore<AdvisorJobResult>(6 * 60 * 1000);

/** AdvisorUpstreamError already carries a friendly, status-specific message
 * as its own .message; AdvisorWallClockTimeoutError's message names an
 * internal constant that isn't itself outage-shaped, so it's classified by
 * type rather than by isOutageError's text matching. Anything else falls
 * back to structural sniffing (connection errors, timeouts, 5xx). */
function classifyOutage(err: unknown): boolean {
  return err instanceof AdvisorUpstreamError || err instanceof AdvisorWallClockTimeoutError || isOutageError(err);
}

async function fullRegeneration(
  ticker: string,
  riskTolerance: RiskTolerance,
  reportStage: (stage: string) => void,
  why: { reason: RegenReason; earningsDate: string | null },
): Promise<AdvisorJobResult> {
  const cachedResearch = await getCachedResearch(ticker);
  let research: ResearchProposal;
  // Whether to reuse depends on WHY we're regenerating, not just on the
  // research's age; see canReuseResearch. (Previously any research under a
  // week old was reused, which silently swallowed the news / earnings
  // events that triggered this regeneration in the first place.)
  if (cachedResearch && canReuseResearch(cachedResearch, why, new Date())) {
    research = cachedResearch.proposal;
  } else {
    reportStage(`Researching ${ticker}'s business, industry, and recent news…`);
    // Even a stale cachedResearch row (past the freshness window, so not
    // reusable outright above) is handed in as a known starting point --
    // researchCompany's own prompt tells it to check/update this, not
    // treat it as a limit on what to search for.
    research = await researchCompany(ticker, cachedResearch?.proposal.research ?? null);
    await cacheResearch(ticker, research);
  }

  // Same 2-year daily history Historical Testing itself uses; fetched once
  // here (not inside scoreForRiskTolerance) so scoring the same ticker
  // across multiple risk tolerances doesn't refetch it each time -- though
  // each risk tolerance currently is its own fullRegeneration call, so this
  // is really one fetch per call for now, not yet shared across the three.
  const { bars } = await yahooDataSource.fetchDailyBars(ticker, '2y');

  const result = await scoreForRiskTolerance(ticker, research, riskTolerance, bars, { onStage: reportStage });
  const retrievedAt = new Date().toISOString();
  await cacheSuggestion(ticker, riskTolerance, result);
  return { ok: true, result: { ...result, retrievedAt, quickUpdateNote: null } };
}

/** Runs the two advisor stages for `ticker` + `riskTolerance`. If a
 * suggestion is already cached for this exact pair, decides between three
 * outcomes rather than regenerating on a fixed calendar schedule:
 *
 * - The known next earnings date has passed: a company's fundamentals and
 *   estimates are genuinely stale the moment it reports, regardless of how
 *   recently the suggestion was otherwise generated -- full regeneration.
 * - No earnings date is known at all (research never found one): there's
 *   no event to key off of, so this falls back to the old fixed freshness
 *   window (a week) as the only signal available -- full regeneration once
 *   that's elapsed, same as before this became earnings-driven.
 * - Otherwise: a single, cheap material-updates check, but only if one
 *   hasn't already been attempted within the last day (see checkedRecently
 *   -- much shorter than the old weekly window, since this check is cheap
 *   and meant to stay responsive to sudden news, not to ration an
 *   expensive call). If it finds something significant, fall through to a
 *   full regeneration so it actually gets incorporated. If not, record the
 *   attempt (and any earnings-date correction it found) without touching
 *   retrieved_at, so "last updated" still reflects the last real
 *   regeneration. If a check was already attempted recently, just return
 *   what's cached, with no new API calls at all.
 *
 * An explicit user refresh (`options.force`) skips all of the above and
 * regenerates with fresh research, guarded only against repeat clicks.
 *
 * The decision itself lives in advisorRefreshPolicy.ts (pure, unit-tested).
 * Whether a regeneration also redoes stage-1 research is a separate gate
 * from the cheap-check window above (see canReuseResearch there): news or
 * a passed earnings date force fresh research unless a sibling risk
 * tolerance already refreshed it since. Any earnings date the cheap check
 * finds is saved to every risk tolerance's row, with or without news.
 *
 * "Now" is always this server's real clock (`new Date()`), never something
 * inferred by a model, so the earnings-date and freshness comparisons can't
 * drift on a model's own sense of the date. */
export function startAdvisorJob(ticker: string, riskTolerance: RiskTolerance, options: { force?: boolean } = {}): string {
  return store.start(
    async (reportStage) => {
      const now = new Date();
      const cached = await getCachedSuggestion(ticker, riskTolerance);
      const decision = decideRefresh(cached && { nextEarningsDate: cached.result.nextEarningsDate, retrievedAt: cached.retrievedAt, lastCheckedAt: cached.lastCheckedAt }, now, { force: options.force });
      const knownEarningsDate = cached?.result.nextEarningsDate ?? null;

      if (decision.action === 'regenerate') {
        return fullRegeneration(ticker, riskTolerance, reportStage, { reason: decision.reason, earningsDate: knownEarningsDate });
      }

      // The other outcomes only exist when something is cached.
      const existing = cached!;
      if (decision.action === 'manual-cooldown') {
        // Not persisted: a transient note explaining why a manual refresh
        // didn't regenerate, shown through the normal quick-update slot.
        const minutes = Math.max(1, Math.ceil((new Date(decision.availableAt).getTime() - now.getTime()) / 60000));
        const note = `Already refreshed recently; a new refresh is available in about ${minutes} min.`;
        return { ok: true, result: { ...existing.result, retrievedAt: existing.retrievedAt, quickUpdateNote: note } };
      }
      if (decision.action === 'serve-cached') {
        // Checked recently enough; nothing new to do.
        return { ok: true, result: { ...existing.result, retrievedAt: existing.retrievedAt, quickUpdateNote: existing.quickUpdateNote } };
      }

      reportStage(`Checking for material news on ${ticker} since the last update…`);
      const today = now.toISOString().slice(0, 10);
      const priorResearch = await getCachedResearch(ticker);
      const check = await checkForMaterialUpdates(ticker, {
        sinceDate: existing.retrievedAt.slice(0, 10),
        now: today,
        priorNextEarningsDate: knownEarningsDate,
        priorResearch: priorResearch?.proposal.research ?? null,
      });

      // The poll's earnings date is saved whichever way the check came out,
      // and onto every risk tolerance's row (it's a fact about the company).
      // check.nextEarningsDate is already validated (strict ISO, not stale)
      // or null; null never overwrites a known date.
      if (check.nextEarningsDate !== null) await recordEarningsDate(ticker, check.nextEarningsDate, check.nextEarningsDateConfirmed, today);

      if (!check.hasUpdates) {
        const note =
          `Quick update attempt as of ${today}: No significant news updates were found ` +
          'across company, industry, or related political news.';
        await recordQuickCheck(ticker, riskTolerance, note, check.nextEarningsDate, check.nextEarningsDateConfirmed);
        return {
          ok: true,
          result: {
            ...existing.result,
            nextEarningsDate: check.nextEarningsDate ?? existing.result.nextEarningsDate,
            nextEarningsDateConfirmed:
              check.nextEarningsDate !== null ? check.nextEarningsDateConfirmed : existing.result.nextEarningsDateConfirmed,
            retrievedAt: existing.retrievedAt,
            quickUpdateNote: note,
          },
        };
      }

      // Material news found; regenerate so it actually gets incorporated,
      // rather than just noted -- and re-research it (see canReuseResearch),
      // since the cached research predates the news.
      return fullRegeneration(ticker, riskTolerance, reportStage, { reason: 'material-news', earningsDate: check.nextEarningsDate ?? knownEarningsDate });
    },
    (err) => ({
      ok: false,
      reason: err instanceof Error ? err.message : String(err),
      outage: classifyOutage(err),
    }),
  );
}

export function getAdvisorJob(id: string) {
  return store.get(id);
}
