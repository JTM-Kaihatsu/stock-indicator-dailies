/**
 * Fixed tool schemas for the advisor's two stages (see advisor.ts):
 * research (submit_research) and risk-tolerance-aware scoring
 * (propose_settings). The settings bounds mirror
 * apps/api/src/routes/backtest.ts's `clampOptions` exactly, so client-,
 * model-, and server-side bounds on the same 9 fields never drift apart.
 */

export const WEB_SEARCH_TOOL = {
  type: 'web_search_20250305' as const,
  name: 'web_search' as const,
  max_uses: 5,
};

/** An investor's stated risk tolerance, used both to tune proposed settings
 * and to judge whether a stock suits that stance at all (see `fit` on
 * RiskScoredProposal). */
export type RiskTolerance = 'averse' | 'neutral' | 'seeking';

export const SUBMIT_RESEARCH_TOOL = {
  name: 'submit_research',
  description:
    'Submit your research findings on this company as a reusable summary. Call this exactly once, as your final action, after you are done researching.',
  input_schema: {
    type: 'object' as const,
    properties: {
      research: {
        type: 'string' as const,
        description:
          "4-8 sentence summary of the company's industry and sector, current trends affecting it, recent " +
          'relevant news, its competitors, and how volatile or speculative its stock currently is. Written to ' +
          'stand alone: it will be reused later, by a separate step, to tune settings for different investor ' +
          "risk tolerances and to judge whether the stock suits each one, without re-researching.",
      },
    },
    required: ['research'],
  },
};

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

/** Validates a parsed `submit_research` tool call input. */
export function validateResearchProposal(input: unknown): ResearchProposal {
  if (typeof input !== 'object' || input === null) {
    throw new Error('submit_research input was not an object');
  }
  const obj = input as Record<string, unknown>;
  if (typeof obj.research !== 'string') {
    throw new Error('submit_research missing research');
  }
  const research = stripTrailingArtifacts(obj.research);
  if (research.length === 0) {
    throw new Error('submit_research missing non-empty research');
  }
  return { research };
}

const FIT_VALUES = ['not-recommended', 'caution', 'within-bounds'] as const;

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
    },
    required: ['rationale', 'settings', 'fit', 'fitReason'],
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

export interface RiskScoredProposal {
  rationale: string;
  settings: ProposedSettings;
  fit: FitVerdict;
  fitReason: string;
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

  return {
    rationale,
    settings: settings as unknown as ProposedSettings,
    fit: obj.fit as FitVerdict,
    fitReason,
  };
}
