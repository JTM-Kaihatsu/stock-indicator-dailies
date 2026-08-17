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

export interface AdvisorProposal {
  rationale: string;
  settings: ProposedSettings;
}

export type AdvisorJobResult = { ok: true; result: AdvisorProposal } | { ok: false; reason: string };

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
