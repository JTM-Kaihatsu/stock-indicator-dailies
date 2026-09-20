/**
 * Local duplication of the advisor's wire shapes (same precedent as
 * types/api.ts's DailyReport); not worth adding the Anthropic SDK to the
 * web bundle's dependency graph for two small types.
 */
import type { BacktestResult } from './backtest.ts';

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

/** One raw grounded excerpt from Gemini's research text and the source(s)
 * it was attributed to (not a synthesized claim; see FieldClaim for that).
 * `sources[].url` is already resolved to the source's real destination,
 * not a raw Google grounding-redirect link. `thumbnailUrl`/`siteName`/
 * `articleTitle` are a best-effort scrape of that page; `siteName` is
 * nearly always present, `thumbnailUrl`/`articleTitle` are commonly absent
 * (scrape failure, or the page has neither tag). */
export interface ResearchQuote {
  quote: string;
  sources: Array<{ title: string; url: string; thumbnailUrl?: string; siteName?: string; articleTitle?: string }>;
}

/** One synthesized claim the advisor made in support of one of its output
 * fields, plus the resolved research quotes backing it. `quotes` can
 * legitimately be empty (pure reasoning/synthesis with nothing directly
 * citable); that's normal, not an error. */
export interface FieldClaim {
  claim: string;
  quotes: ResearchQuote[];
}

/** Which synthesized claims back each field of the proposal; powers the
 * "sources" drawer next to each claim in the AI Suggestion panel. An empty
 * array for a field is normal (nothing specific enough to break out). */
export interface FieldCitations {
  rationale: FieldClaim[];
  fitReason: FieldClaim[];
  earningsOutlook: FieldClaim[];
  earningsLikelihoodReason: FieldClaim[];
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
  /** How the settings above actually performed against this ticker's real
   * 2-year price history, from the same run_backtest validation the
   * advisor used to check its own work server-side. Powers Historical
   * Testing's scenario slot automatically, no separate "Run Testing"
   * click needed. null for a suggestion cached before this field existed,
   * or when that final validation run itself failed. */
  backtestResult: BacktestResult | null;
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
  | { status: 'pending'; stage?: string }
  | { status: 'done'; result: AdvisorJobResult }
  | { status: 'not-found' };
