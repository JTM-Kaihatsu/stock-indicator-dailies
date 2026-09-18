/**
 * Local duplication of the advisor's wire shapes (same precedent as
 * types/api.ts's DailyReport); not worth adding the Anthropic SDK to the
 * web bundle's dependency graph for two small types.
 */
export interface ProposedSettings {
  buyConsensus: number;
  sellConsensus: number;
  recencyDays: number;
  persistenceBars: number;
  minHoldingDays: number;
  atrMultiplier?: number | null;
  atrPeriod: number;
  adxThreshold?: number | null;
  adxPeriod: number;
}

/** Whether the stock itself, per the advisor's research, suits the risk
 * tolerance it was scored against; independent of how the settings above
 * were tuned. */
export type FitVerdict = 'not-recommended' | 'caution' | 'within-bounds';

/** How likely the next earnings report is to meet analyst expectations, per
 * the advisor's research (historical pattern, industry trends, and any
 * political/regulatory factors it found). */
export type EarningsLikelihood = 'low' | 'moderate' | 'high';

/** One piece of Gemini's grounded research text and the source(s) it was
 * attributed to. `sources[].url` is a Google grounding-redirect link, not
 * a direct link to the source, but it resolves to the original page. */
export interface ResearchCitation {
  claim: string;
  sources: Array<{ title: string; url: string }>;
}

/** Which research citations back each field of the proposal; powers the
 * "sources" info button next to each claim in the AI Suggestion panel. An
 * empty array for a field is normal (pure reasoning, nothing to cite). */
export interface FieldCitations {
  rationale: ResearchCitation[];
  fitReason: ResearchCitation[];
  earningsOutlook: ResearchCitation[];
  earningsLikelihoodReason: ResearchCitation[];
}

export interface AdvisorProposal {
  rationale: string;
  settings: ProposedSettings;
  fit: FitVerdict;
  fitReason: string;
  nextEarningsDate: string | null;
  earningsOutlook: string;
  earningsLikelihood: EarningsLikelihood;
  earningsLikelihoodReason: string;
  fieldCitations: FieldCitations;
  /** When this suggestion was last fully regenerated; what "last updated"
   * on the AI Suggestion panel shows. Not the same as a quick-check, which
   * only appends quickUpdateNote below without changing this. */
  retrievedAt: string;
  /** A cheap refresh found nothing significant since retrievedAt; shown as
   * an appended note rather than a full regeneration. null if none is
   * pending (never refreshed, or the last refresh was a full one). */
  quickUpdateNote: string | null;
}

export type AdvisorJobResult =
  | { ok: true; result: AdvisorProposal }
  | {
      ok: false;
      reason: string;
      /** Whether this looks like Claude being unavailable rather than a
       * one-off failure; drives the retry cooldown and status-page hint. */
      outage: boolean;
    };

/** POST /advisor/start always starts a job now, even for an exact
 * ticker+tolerance that's already cached: the refresh flow needs at least
 * a cheap quick-check before it can resolve, so there's no true inline
 * "hit" shortcut left (see apps/api/src/advisorJobs.ts). */
export type StartAdvisorResponse =
  | { ok: true; jobId: string }
  | { ok: false; reason: string };

export type AdvisorJobStatusResponse =
  | { status: 'pending' }
  | { status: 'done'; result: AdvisorJobResult }
  | { status: 'not-found' };
