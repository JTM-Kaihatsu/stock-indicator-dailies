import {
  AdvisorUpstreamError,
  AdvisorWallClockTimeoutError,
  checkForMaterialUpdates,
  researchCompany,
  scoreForRiskTolerance,
  type RiskScoredProposal,
  type RiskTolerance,
} from '@stock-indicator-dailies/advisor';
import { yahooDataSource } from '@stock-indicator-dailies/indicators';
import { isOutageError } from '@stock-indicator-dailies/shared';

import { appendQuickUpdateNote, cacheResearch, cacheSuggestion, getCachedResearch, getCachedSuggestion, isFresh } from './advisorCache.ts';
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

function isPastEarningsDate(nextEarningsDate: string | null, now: Date): boolean {
  if (!nextEarningsDate) return false;
  // Through the end of that calendar day (UTC), not the instant it starts;
  // an earnings date is still "current" for the whole day it happens.
  return now.getTime() > new Date(`${nextEarningsDate}T23:59:59Z`).getTime();
}

async function fullRegeneration(
  ticker: string,
  riskTolerance: RiskTolerance,
  reportStage: (stage: string) => void,
): Promise<AdvisorJobResult> {
  let research = await getCachedResearch(ticker);
  if (!research) {
    reportStage(`Researching ${ticker}'s business, industry, and recent news…`);
    research = await researchCompany(ticker);
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
 * suggestion is already cached for this exact pair, tries a cheap refresh
 * before paying for a full re-research + re-score:
 *
 * - Within the cache's normal freshness window (a week), and the next
 *   earnings date (if any) hasn't passed yet: run a single, cheap
 *   material-updates check. If nothing significant turns up, just append a
 *   dated note to the existing suggestion instead of regenerating it.
 * - Otherwise (no cache, past the freshness window, the earnings date has
 *   passed, or the quick check itself found something significant): do a
 *   full regeneration, same as before, reusing cached research when that's
 *   still fresh regardless of the suggestion cache's own state.
 *
 * "Now" is always this server's real clock (`new Date()`), never something
 * inferred by a model, so the earnings-date and freshness comparisons can't
 * drift on a model's own sense of the date. */
export function startAdvisorJob(ticker: string, riskTolerance: RiskTolerance): string {
  return store.start(
    async (reportStage) => {
      const now = new Date();
      const cached = await getCachedSuggestion(ticker, riskTolerance);

      if (cached && isFresh(cached.retrievedAt) && !isPastEarningsDate(cached.result.nextEarningsDate, now)) {
        reportStage(`Checking for material news on ${ticker} since the last update…`);
        const check = await checkForMaterialUpdates(ticker, cached.retrievedAt.slice(0, 10), now.toISOString().slice(0, 10));
        if (!check.hasUpdates) {
          const note =
            `Quick update attempt as of ${now.toISOString().slice(0, 10)}: No significant news updates were found ` +
            'across company, industry, or related political news.';
          await appendQuickUpdateNote(ticker, riskTolerance, note);
          return { ok: true, result: { ...cached.result, retrievedAt: cached.retrievedAt, quickUpdateNote: note } };
        }
        // Material news found; fall through to a full regeneration so it
        // actually gets incorporated, rather than just noted.
      }

      return fullRegeneration(ticker, riskTolerance, reportStage);
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
