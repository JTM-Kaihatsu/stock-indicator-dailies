import type { FieldCitations, FieldClaim, ResearchProposal, ResearchQuote, RiskScoredProposal, RiskTolerance } from '@stock-indicator-dailies/advisor';
import type { BacktestResult } from '@stock-indicator-dailies/eval-backtest';

import { getSupabaseClient as getClient } from './supabaseClient.ts';

/** A cached row is fresh for this long from `retrieved_at`; older is a
 * miss. A week for research (still just "how long is a writeup worth
 * reusing without re-researching"). For a suggestion, this is now only a
 * fallback trigger for a full regeneration when no earnings date is known
 * at all (see advisorJobs.ts) -- the normal case is earnings-date-driven,
 * not a fixed calendar window. */
const CACHE_WINDOW_HOURS = 24 * 7;

/** Exported so advisorJobs.ts's refresh flow can apply the same freshness
 * window to a suggestion row it already has (see getCachedSuggestion,
 * which no longer hides a stale row behind `null` the way this module's
 * other caches do; the refresh flow needs to see a stale row too, to
 * decide whether it's cheap-refreshable or needs a full regeneration). */
export function isFresh(retrievedAt: string): boolean {
  return Date.now() - new Date(retrievedAt).getTime() <= CACHE_WINDOW_HOURS * 60 * 60 * 1000;
}

/** Much shorter than CACHE_WINDOW_HOURS: this gates how often the cheap
 * material-update check itself is even attempted, not whether a full
 * regeneration is warranted (that's earnings-date-driven now; see
 * advisorJobs.ts). A day, not a week, since the check is cheap and meant
 * to stay responsive to sudden news, not to ration an expensive call. */
const CHEAP_CHECK_WINDOW_HOURS = 24;

/** Whether a quick material-update check has already been attempted
 * recently enough (successful or not) that running another one isn't
 * worth it yet. `null` (never checked, including every row from before
 * this column existed) counts as NOT recent, so a check is always
 * attempted at least once. */
export function checkedRecently(lastCheckedAt: string | null): boolean {
  if (!lastCheckedAt) return false;
  return Date.now() - new Date(lastCheckedAt).getTime() <= CHEAP_CHECK_WINDOW_HOURS * 60 * 60 * 1000;
}

interface ResearchCacheRow {
  ticker: string;
  retrieved_at: string;
  research: string;
  citations: ResearchQuote[];
}

/** True for a research quote in the new {quote, sources} shape; false for
 * an old-shaped {claim, sources} row (or anything else malformed) from
 * before the citation-claim restructure, so a stale cached row degrades to
 * "no citations" instead of crashing the frontend. */
function isResearchQuote(v: unknown): v is ResearchQuote {
  return typeof v === 'object' && v !== null && typeof (v as { quote?: unknown }).quote === 'string';
}

/** Same guard as isResearchQuote, for a FieldClaim ({claim, quotes}) versus
 * the old flat ResearchCitation ({claim, sources}) shape it replaced: both
 * happen to have a string `claim`, so the distinguishing field is `quotes`
 * being an array (old rows have no `quotes` key at all). */
function isFieldClaim(v: unknown): v is FieldClaim {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as { claim?: unknown }).claim === 'string' &&
    Array.isArray((v as { quotes?: unknown }).quotes)
  );
}

export interface CachedResearch {
  proposal: ResearchProposal;
  retrievedAt: string;
}

/** Look up cached research for `ticker`, regardless of which risk
 * tolerance ends up being scored against it (research doesn't vary by
 * who's asking), and regardless of freshness: unlike before, a stale row
 * is NOT hidden behind `null` here, same reasoning as getCachedSuggestion
 * below. A caller that wants to reuse it outright still needs to check
 * `isFresh(retrievedAt)` itself; a caller doing a fresh regeneration can
 * use even a stale row's `proposal.research` as prior-context for
 * researchCompany/checkForMaterialUpdates (see advisorJobs.ts), since
 * "what we knew last time, possibly outdated" is still a useful starting
 * point for those. `null` only on a genuine miss, or when Supabase isn't
 * configured or the lookup fails. */
export async function getCachedResearch(ticker: string): Promise<CachedResearch | null> {
  const db = getClient();
  if (!db) return null;

  try {
    const { data, error } = await db
      .from('advisor_research_cache')
      .select('ticker, retrieved_at, research, citations')
      .eq('ticker', ticker)
      .maybeSingle<ResearchCacheRow>();
    if (error || !data) return null;
    return {
      proposal: { research: data.research, citations: (data.citations ?? []).filter(isResearchQuote) },
      retrievedAt: data.retrieved_at,
    };
  } catch {
    return null;
  }
}

/** Persist fresh research, overwriting any prior row for the ticker.
 * Best-effort: caching is an optimization, not part of the actual result,
 * so a Supabase hiccup here must never turn an already-successful research
 * call into a reported failure for the caller. */
export async function cacheResearch(ticker: string, research: ResearchProposal): Promise<void> {
  const db = getClient();
  if (!db) return;

  try {
    await db.from('advisor_research_cache').upsert({
      ticker,
      retrieved_at: new Date().toISOString(),
      research: research.research,
      citations: research.citations,
    });
  } catch {
    // Best-effort; never let caching itself fail an otherwise-successful request.
  }
}

interface SuggestionCacheRow {
  ticker: string;
  risk_tolerance: string;
  retrieved_at: string;
  rationale: string;
  settings: RiskScoredProposal['settings'];
  fit: string;
  fit_reason: string;
  next_earnings_date: string | null;
  earnings_outlook: string;
  earnings_likelihood: string;
  earnings_likelihood_reason: string;
  quick_update_note: string | null;
  field_citations: Partial<FieldCitations>;
  backtest_result: BacktestResult | null;
  last_checked_at: string | null;
}

const EMPTY_FIELD_CITATIONS: FieldCitations = {
  rationale: [], fitReason: [], earningsOutlook: [], earningsLikelihoodReason: [],
};

function toProposal(row: SuggestionCacheRow): RiskScoredProposal {
  return {
    rationale: row.rationale,
    settings: row.settings,
    fit: row.fit as RiskScoredProposal['fit'],
    fitReason: row.fit_reason,
    nextEarningsDate: row.next_earnings_date,
    earningsOutlook: row.earnings_outlook,
    earningsLikelihood: row.earnings_likelihood as RiskScoredProposal['earningsLikelihood'],
    earningsLikelihoodReason: row.earnings_likelihood_reason,
    fieldCitations: sanitizeFieldCitations(row.field_citations),
    backtestResult: row.backtest_result ?? null,
  };
}

/** Merges a cached field_citations blob over the empty default (backfilling
 * any field missing entirely, e.g. an older row from before a field
 * existed), then drops any array entry that isn't a well-formed FieldClaim:
 * a row cached before the claim/quote restructure has old-shaped
 * ResearchCitation entries ({claim, sources}, no `quotes`) that would
 * otherwise crash the frontend's `.quotes.map(...)`. Degrades a stale row
 * to "no citations shown" rather than throwing. */
function sanitizeFieldCitations(raw: Partial<FieldCitations> | null | undefined): FieldCitations {
  const merged = { ...EMPTY_FIELD_CITATIONS, ...raw };
  return {
    rationale: (merged.rationale ?? []).filter(isFieldClaim),
    fitReason: (merged.fitReason ?? []).filter(isFieldClaim),
    earningsOutlook: (merged.earningsOutlook ?? []).filter(isFieldClaim),
    earningsLikelihoodReason: (merged.earningsLikelihoodReason ?? []).filter(isFieldClaim),
  };
}

export interface CachedSuggestion {
  result: RiskScoredProposal;
  retrievedAt: string;
  /** The appended "quick update attempt as of ..." note from the last
   * refresh that found nothing significant; null if none is pending (either
   * never refreshed, or the last refresh was a full regeneration). */
  quickUpdateNote: string | null;
  /** When a material-update check (successful or not) was last attempted
   * for this row, independent of retrievedAt (which only moves on a full
   * regeneration); null if never checked, including any row from before
   * this column existed. Use the exported `checkedRecently` to decide
   * whether another cheap check is worth attempting yet. */
  lastCheckedAt: string | null;
}

/** Look up a cached suggestion for this exact (ticker, risk tolerance)
 * pair, regardless of freshness; `null` only on a genuine miss or any
 * failure. Unlike getCachedResearch, staleness is NOT hidden here: the
 * refresh flow in advisorJobs.ts needs to see a stale row (and its
 * retrievedAt) too, to decide whether a quick check or a full
 * regeneration is appropriate; use the exported `isFresh` to check. */
export async function getCachedSuggestion(ticker: string, riskTolerance: RiskTolerance): Promise<CachedSuggestion | null> {
  const db = getClient();
  if (!db) return null;

  try {
    const { data, error } = await db
      .from('advisor_suggestion_cache')
      .select(
        'ticker, risk_tolerance, retrieved_at, rationale, settings, fit, fit_reason, ' +
          'next_earnings_date, earnings_outlook, earnings_likelihood, earnings_likelihood_reason, ' +
          'quick_update_note, field_citations, backtest_result, last_checked_at',
      )
      .eq('ticker', ticker)
      .eq('risk_tolerance', riskTolerance)
      .maybeSingle<SuggestionCacheRow>();
    if (error || !data) return null;
    return {
      result: toProposal(data),
      retrievedAt: data.retrieved_at,
      quickUpdateNote: data.quick_update_note,
      lastCheckedAt: data.last_checked_at,
    };
  } catch {
    return null;
  }
}

/** Persist a fresh suggestion from a full regeneration, overwriting any
 * prior row for this exact (ticker, risk tolerance) pair (including
 * clearing any pending quick-update note; other risk tolerances' cached
 * suggestions for the same ticker are untouched). Best-effort, same
 * posture as cacheResearch. Sets last_checked_at alongside retrieved_at: a
 * full regeneration is, among other things, as current a check as
 * possible. */
export async function cacheSuggestion(ticker: string, riskTolerance: RiskTolerance, result: RiskScoredProposal): Promise<void> {
  const db = getClient();
  if (!db) return;

  try {
    const now = new Date().toISOString();
    await db.from('advisor_suggestion_cache').upsert({
      ticker,
      risk_tolerance: riskTolerance,
      retrieved_at: now,
      rationale: result.rationale,
      settings: result.settings,
      fit: result.fit,
      fit_reason: result.fitReason,
      next_earnings_date: result.nextEarningsDate,
      earnings_outlook: result.earningsOutlook,
      earnings_likelihood: result.earningsLikelihood,
      earnings_likelihood_reason: result.earningsLikelihoodReason,
      quick_update_note: null,
      field_citations: result.fieldCitations,
      backtest_result: result.backtestResult,
      last_checked_at: now,
    });
  } catch {
    // Best-effort.
  }
}

/** Records the outcome of a material-update check against an existing
 * suggestion row: the note, and (best-effort) a corrected earnings date,
 * without touching anything else -- in particular, not retrieved_at: this
 * was a cheap check, not a real regeneration, so "last updated" should
 * still reflect the last full regeneration. Always bumps last_checked_at
 * so the cheap-check cadence (see checkedRecently) is tracked from this
 * attempt, whether or not it found anything. `nextEarningsDate` is only
 * written when non-null: an absent/UNKNOWN result from one check shouldn't
 * clobber a genuinely known date from before. A no-op if the row doesn't
 * exist, which shouldn't happen in practice (the refresh flow only calls
 * this after already reading the row it's updating). */
export async function recordQuickCheck(
  ticker: string,
  riskTolerance: RiskTolerance,
  note: string,
  nextEarningsDate: string | null,
): Promise<void> {
  const db = getClient();
  if (!db) return;

  try {
    const patch: Record<string, unknown> = { quick_update_note: note, last_checked_at: new Date().toISOString() };
    if (nextEarningsDate !== null) patch.next_earnings_date = nextEarningsDate;
    await db.from('advisor_suggestion_cache').update(patch).eq('ticker', ticker).eq('risk_tolerance', riskTolerance);
  } catch {
    // Best-effort.
  }
}
