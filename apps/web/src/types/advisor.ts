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

export interface AdvisorProposal {
  rationale: string;
  settings: ProposedSettings;
  fit: FitVerdict;
  fitReason: string;
  nextEarningsDate: string | null;
  earningsOutlook: string;
  earningsLikelihood: EarningsLikelihood;
  earningsLikelihoodReason: string;
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

/** A cache hit resolves inline with the result; a miss returns a job id to
 * poll instead. Same shape as StartResponse for the daily pipeline. */
export type StartAdvisorResponse =
  | { ok: true; result: AdvisorProposal }
  | { ok: true; jobId: string }
  | { ok: false; reason: string };

export type AdvisorJobStatusResponse =
  | { status: 'pending' }
  | { status: 'done'; result: AdvisorJobResult }
  | { status: 'not-found' };
