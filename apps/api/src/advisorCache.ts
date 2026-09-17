import type { RiskScoredProposal, RiskTolerance } from '@stock-indicator-dailies/advisor';

import { getSupabaseClient as getClient } from './supabaseClient.ts';

/** A cached row is fresh for this long from `retrieved_at`; older is a
 * miss. A week for both stages, same reasoning as before: a company's
 * research profile (and a suggestion derived from it) doesn't go stale
 * hour-to-hour the way a chart does; the point of caching this at all is
 * mainly to avoid repeated slow, web-search-backed calls during testing
 * and demos. */
const CACHE_WINDOW_HOURS = 24 * 7;

function isFresh(retrievedAt: string): boolean {
  return Date.now() - new Date(retrievedAt).getTime() <= CACHE_WINDOW_HOURS * 60 * 60 * 1000;
}

interface ResearchCacheRow {
  ticker: string;
  retrieved_at: string;
  research: string;
}

/** Look up cached research for `ticker`, regardless of which risk
 * tolerance ends up being scored against it (research doesn't vary by
 * who's asking). `null` on a miss, an expired row, or when Supabase isn't
 * configured or the lookup fails; all treated the same by the caller. */
export async function getCachedResearch(ticker: string): Promise<string | null> {
  const db = getClient();
  if (!db) return null;

  try {
    const { data, error } = await db
      .from('advisor_research_cache')
      .select('ticker, retrieved_at, research')
      .eq('ticker', ticker)
      .maybeSingle<ResearchCacheRow>();
    if (error || !data || !isFresh(data.retrieved_at)) return null;
    return data.research;
  } catch {
    return null;
  }
}

/** Persist fresh research, overwriting any prior row for the ticker.
 * Best-effort: caching is an optimization, not part of the actual result,
 * so a Supabase hiccup here must never turn an already-successful research
 * call into a reported failure for the caller. */
export async function cacheResearch(ticker: string, research: string): Promise<void> {
  const db = getClient();
  if (!db) return;

  try {
    await db.from('advisor_research_cache').upsert({
      ticker,
      retrieved_at: new Date().toISOString(),
      research,
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
}

function toProposal(row: SuggestionCacheRow): RiskScoredProposal {
  return {
    rationale: row.rationale,
    settings: row.settings,
    fit: row.fit as RiskScoredProposal['fit'],
    fitReason: row.fit_reason,
  };
}

/** Look up a fresh cached suggestion for this exact (ticker, risk
 * tolerance) pair. `null` on a miss, an expired row, or any failure. */
export async function getCachedSuggestion(ticker: string, riskTolerance: RiskTolerance): Promise<RiskScoredProposal | null> {
  const db = getClient();
  if (!db) return null;

  try {
    const { data, error } = await db
      .from('advisor_suggestion_cache')
      .select('ticker, risk_tolerance, retrieved_at, rationale, settings, fit, fit_reason')
      .eq('ticker', ticker)
      .eq('risk_tolerance', riskTolerance)
      .maybeSingle<SuggestionCacheRow>();
    if (error || !data || !isFresh(data.retrieved_at)) return null;
    return toProposal(data);
  } catch {
    return null;
  }
}

/** Persist a fresh suggestion, overwriting any prior row for this exact
 * (ticker, risk tolerance) pair; other risk tolerances' cached suggestions
 * for the same ticker are untouched. Best-effort, same posture as
 * cacheResearch. */
export async function cacheSuggestion(ticker: string, riskTolerance: RiskTolerance, result: RiskScoredProposal): Promise<void> {
  const db = getClient();
  if (!db) return;

  try {
    await db.from('advisor_suggestion_cache').upsert({
      ticker,
      risk_tolerance: riskTolerance,
      retrieved_at: new Date().toISOString(),
      rationale: result.rationale,
      settings: result.settings,
      fit: result.fit,
      fit_reason: result.fitReason,
    });
  } catch {
    // Best-effort.
  }
}
