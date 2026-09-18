/**
 * Fixed tool schema for the advisor's stage 2, risk-tolerance-aware scoring
 * (propose_settings; see advisor.ts). Stage 1 (research) runs on Gemini +
 * Grounding with Google Search, which returns plain text rather than a
 * structured tool call, so it has no schema here. The settings bounds
 * mirror apps/api/src/routes/backtest.ts's `clampOptions` exactly, so
 * client-, model-, and server-side bounds on the same 9 fields never drift
 * apart.
 */

/** An investor's stated risk tolerance, used both to tune proposed settings
 * and to judge whether a stock suits that stance at all (see `fit` on
 * RiskScoredProposal). */
export type RiskTolerance = 'averse' | 'neutral' | 'seeking';

/** Stage 1's output: a reusable research brief, gathered by Gemini via
 * Grounding with Google Search. Plain text, not a validated tool-call shape
 * (Gemini's grounding tool doesn't combine with forced structured output),
 * so stage 2 (Claude) is what actually structures anything out of it. */
export interface ResearchProposal {
  research: string;
}

/**
 * Strips stray pseudo-XML tags observed, rarely, trailing the real content
 * of the last string field in a forced tool call (e.g. a live capture
 * ending in "...tuned.</fitReason>\n</invoke>\n"); tool-call-scaffolding
 * text that leaked into the field value itself rather than staying out of
 * it. Only touches a trailing run of `<tag>`/`</tag>`-shaped text, so it
 * can't eat legitimate prose content earlier in the string.
 */
function stripTrailingArtifacts(text: string): string {
  return text.replace(/(?:\s*<\/?[a-zA-Z_][\w-]*>)+\s*$/, '').trim();
}

const FIT_VALUES = ['not-recommended', 'caution', 'within-bounds'] as const;
const EARNINGS_LIKELIHOOD_VALUES = ['low', 'moderate', 'high'] as const;

export const PROPOSE_SETTINGS_TOOL = {
  name: 'propose_settings',
  description:
    'Propose specific indicator-lever setting changes for this ticker, tuned for the given risk tolerance, ' +
    'and judge whether this stock actually suits that risk tolerance at all. Call this exactly once, as your ' +
    'final action, after weighing the research you were given.',
  input_schema: {
    type: 'object' as const,
    properties: {
      rationale: {
        type: 'string' as const,
        description: '2-4 sentence explanation of the settings grounded in the research and the stated risk tolerance.',
      },
      settings: {
        type: 'object' as const,
        properties: {
          buyConsensus: { type: 'integer' as const, minimum: 1, maximum: 3 },
          sellConsensus: { type: 'integer' as const, minimum: 1, maximum: 3 },
          recencyDays: { type: 'integer' as const, minimum: 1, maximum: 60 },
          persistenceBars: { type: 'integer' as const, minimum: 1, maximum: 30 },
          minHoldingDays: { type: 'integer' as const, minimum: 0, maximum: 365 },
          atrMultiplier: { type: ['number', 'null'] as const, minimum: 0, maximum: 20 },
          atrPeriod: { type: 'integer' as const, minimum: 2, maximum: 100 },
          adxThreshold: { type: ['number', 'null'] as const, minimum: 0, maximum: 100 },
          adxPeriod: { type: 'integer' as const, minimum: 2, maximum: 100 },
        },
        required: [
          'buyConsensus', 'sellConsensus', 'recencyDays', 'persistenceBars',
          'minHoldingDays', 'atrPeriod', 'adxPeriod',
        ],
      },
      fit: {
        type: 'string' as const,
        enum: [...FIT_VALUES],
        description:
          'Whether the STOCK ITSELF (per the research; independent of how the settings above are tuned) suits ' +
          "the stated risk tolerance. Tuning the settings defensively does not make an unsuitable stock " +
          '"within-bounds"; judge the company, not the knobs.',
      },
      fitReason: {
        type: 'string' as const,
        description: '1-2 sentence justification for the fit verdict, citing specifics from the research.',
      },
      nextEarningsDate: {
        type: ['string', 'null'] as const,
        description:
          "The company's next scheduled earnings report date (ISO 8601, e.g. \"2026-10-22\"), per the " +
          "research. null if the research doesn't mention one; never guess.",
      },
      earningsOutlook: {
        type: 'string' as const,
        description:
          'What analysts expect and are watching for at the next earnings report, and the upside if those ' +
          "expectations are met or beaten, per the research. State honestly if the research doesn't cover this.",
      },
      earningsLikelihood: {
        type: 'string' as const,
        enum: [...EARNINGS_LIKELIHOOD_VALUES],
        description:
          "How likely those expectations are to be met, reasoned from the company's historical earnings " +
          'pattern, current industry trends, and any political/regulatory factors the research covers.',
      },
      earningsLikelihoodReason: {
        type: 'string' as const,
        description: '1-3 sentence justification for the earnings likelihood, citing specifics from the research.',
      },
    },
    required: [
      'rationale', 'settings', 'fit', 'fitReason',
      'nextEarningsDate', 'earningsOutlook', 'earningsLikelihood', 'earningsLikelihoodReason',
    ],
  },
};

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

export type FitVerdict = (typeof FIT_VALUES)[number];
export type EarningsLikelihood = (typeof EARNINGS_LIKELIHOOD_VALUES)[number];

export interface RiskScoredProposal {
  rationale: string;
  settings: ProposedSettings;
  fit: FitVerdict;
  fitReason: string;
  nextEarningsDate: string | null;
  earningsOutlook: string;
  earningsLikelihood: EarningsLikelihood;
  earningsLikelihoodReason: string;
}

const RANGES: Record<keyof ProposedSettings, [number, number]> = {
  buyConsensus: [1, 3],
  sellConsensus: [1, 3],
  recencyDays: [1, 60],
  persistenceBars: [1, 30],
  minHoldingDays: [0, 365],
  atrMultiplier: [0, 20],
  atrPeriod: [2, 100],
  adxThreshold: [0, 100],
  adxPeriod: [2, 100],
};

/** Validates a parsed `propose_settings` tool call input against the same
 * bounds the backend enforces. Throws with a specific message on the first
 * violation; the caller decides how to handle a model that ignored the
 * schema's declared bounds. */
export function validateRiskScoredProposal(input: unknown): RiskScoredProposal {
  if (typeof input !== 'object' || input === null) {
    throw new Error('propose_settings input was not an object');
  }
  const obj = input as Record<string, unknown>;
  if (typeof obj.rationale !== 'string') {
    throw new Error('propose_settings missing a rationale');
  }
  const rationale = stripTrailingArtifacts(obj.rationale);
  if (rationale.length === 0) {
    throw new Error('propose_settings missing a non-empty rationale');
  }
  if (typeof obj.fit !== 'string' || !FIT_VALUES.includes(obj.fit as FitVerdict)) {
    throw new Error(`propose_settings field "fit"=${JSON.stringify(obj.fit)} must be one of ${FIT_VALUES.join(', ')}`);
  }
  if (typeof obj.fitReason !== 'string') {
    throw new Error('propose_settings missing a fitReason');
  }
  const fitReason = stripTrailingArtifacts(obj.fitReason);
  if (fitReason.length === 0) {
    throw new Error('propose_settings missing a non-empty fitReason');
  }
  if (typeof obj.settings !== 'object' || obj.settings === null) {
    throw new Error('propose_settings missing a settings object');
  }
  const settings = obj.settings as Record<string, unknown>;

  for (const [key, [min, max]] of Object.entries(RANGES) as Array<[keyof ProposedSettings, [number, number]]>) {
    const value = settings[key];
    const nullable = key === 'atrMultiplier' || key === 'adxThreshold';
    if (value === undefined || value === null) {
      if (nullable) continue;
      throw new Error(`propose_settings missing required field "${key}"`);
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`propose_settings field "${key}" is not a finite number`);
    }
    if (value < min || value > max) {
      throw new Error(`propose_settings field "${key}"=${value} is outside the allowed range [${min}, ${max}]`);
    }
  }

  if (obj.nextEarningsDate !== null && typeof obj.nextEarningsDate !== 'string') {
    throw new Error('propose_settings field "nextEarningsDate" must be a string or null');
  }
  const strippedEarningsDate = typeof obj.nextEarningsDate === 'string' ? stripTrailingArtifacts(obj.nextEarningsDate) : '';
  const nextEarningsDate = strippedEarningsDate.length > 0 ? strippedEarningsDate : null;

  if (typeof obj.earningsOutlook !== 'string') {
    throw new Error('propose_settings missing earningsOutlook');
  }
  const earningsOutlook = stripTrailingArtifacts(obj.earningsOutlook);
  if (earningsOutlook.length === 0) {
    throw new Error('propose_settings missing a non-empty earningsOutlook');
  }

  if (typeof obj.earningsLikelihood !== 'string' || !EARNINGS_LIKELIHOOD_VALUES.includes(obj.earningsLikelihood as EarningsLikelihood)) {
    throw new Error(
      `propose_settings field "earningsLikelihood"=${JSON.stringify(obj.earningsLikelihood)} must be one of ${EARNINGS_LIKELIHOOD_VALUES.join(', ')}`,
    );
  }

  if (typeof obj.earningsLikelihoodReason !== 'string') {
    throw new Error('propose_settings missing earningsLikelihoodReason');
  }
  const earningsLikelihoodReason = stripTrailingArtifacts(obj.earningsLikelihoodReason);
  if (earningsLikelihoodReason.length === 0) {
    throw new Error('propose_settings missing a non-empty earningsLikelihoodReason');
  }

  return {
    rationale,
    settings: settings as unknown as ProposedSettings,
    fit: obj.fit as FitVerdict,
    fitReason,
    nextEarningsDate,
    earningsOutlook,
    earningsLikelihood: obj.earningsLikelihood as EarningsLikelihood,
    earningsLikelihoodReason,
  };
}
