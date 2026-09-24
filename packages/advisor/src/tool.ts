/**
 * Fixed tool schemas for the advisor's stage 2, risk-tolerance-aware
 * scoring (propose_settings and run_backtest; see advisor.ts). Stage 1
 * (research) runs on Gemini + Grounding with Google Search, which returns
 * plain text rather than a structured tool call, so it has no schema here.
 * The settings bounds mirror apps/api/src/routes/backtest.ts's
 * `clampOptions` exactly, so client-, model-, and server-side bounds on
 * the same 9 fields never drift apart.
 */
import type { BacktestResult } from '@stock-indicator-dailies/eval-backtest';

/** An investor's stated risk tolerance, used both to tune proposed settings
 * and to judge whether a stock suits that stance at all (see `fit` on
 * RiskScoredProposal). */
export type RiskTolerance = 'averse' | 'neutral' | 'seeking';

/** One raw grounded excerpt from Gemini's research text, and the source(s)
 * it was attributed to. `quote` is the exact segment of research text
 * Gemini's own grounding metadata tied to these sources (not something we
 * invented by parsing prose, and not a synthesized claim; see FieldClaim
 * for that); `sources[].url` is already resolved to the source's real
 * destination by extractCitations (advisor.ts), not the raw Google
 * grounding-redirect link Gemini itself returns. `title` is Gemini's own
 * label for the source (often just its domain, e.g. "gurufocus.com").
 * `thumbnailUrl`/`siteName`/`articleTitle` are a best-effort
 * og:image|twitter:image / og:site_name / og:title|<title> scrape of that
 * same page; `siteName` is nearly always present (falls back to a
 * hostname-derived label with no network needed), `thumbnailUrl` and
 * `articleTitle` are commonly absent (scrape failure, or the page simply
 * has neither tag). */
export interface ResearchQuote {
  quote: string;
  sources: Array<{ title: string; url: string; thumbnailUrl?: string; siteName?: string; articleTitle?: string }>;
}

/** Stage 1's output: a reusable research brief, gathered by Gemini via
 * Grounding with Google Search. `research` is plain text, not a validated
 * tool-call shape (Gemini's grounding tool doesn't combine with forced
 * structured output), so stage 2 (Claude) is what actually structures
 * anything out of it, `citations` included: stage 2 picks which of these
 * back each claim it makes (see FieldCitations). */
export interface ResearchProposal {
  research: string;
  citations: ResearchQuote[];
}

/** One synthesized claim stage 2 (Claude) made in support of one of its own
 * output fields, plus the resolved research quotes backing it (full
 * quote + sources, not just indices, so a cached suggestion stays
 * self-contained even if research is later regenerated). `claim` is
 * Claude's own short synthesized takeaway (e.g. "Google has historically
 * overcome cloud-scaling challenges"), not a copy of the field text itself.
 * `quotes` can legitimately be empty: a claim built from the research's
 * own guided progression (likelihood, obstacles) is often synthesis rather
 * than a single directly-citable sentence, and that's kept, not dropped;
 * only a citation index a model got wrong is dropped (see resolveCitations). */
export interface FieldClaim {
  claim: string;
  quotes: ResearchQuote[];
}

/** Which synthesized claims stage 2 (Claude) made for each field of its own
 * output. Powers the AI Suggestion panel's per-field "sources" drawer.
 * Empty array is normal (a field can be pure synthesis with nothing
 * specific enough to break out as its own claim). */
export interface FieldCitations {
  rationale: FieldClaim[];
  fitReason: FieldClaim[];
  earningsOutlook: FieldClaim[];
  earningsLikelihoodReason: FieldClaim[];
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

/** The 9 tunable levers' JSON-schema properties, shared verbatim between
 * PROPOSE_SETTINGS_TOOL (nested under `settings`) and RUN_BACKTEST_TOOL
 * (top-level, since a backtest candidate has no other fields alongside
 * it), so the two tools' declared bounds can never drift apart from each
 * other the way three independently hand-copied tables could. */
const LEVER_PROPERTIES = {
  buyConsensus: { type: 'integer' as const, minimum: 1, maximum: 3 },
  sellConsensus: { type: 'integer' as const, minimum: 1, maximum: 3 },
  recencyDays: { type: 'integer' as const, minimum: 1, maximum: 60 },
  persistenceBars: { type: 'integer' as const, minimum: 1, maximum: 30 },
  minHoldingDays: { type: 'integer' as const, minimum: 0, maximum: 365 },
  atrMultiplier: { type: ['number', 'null'] as const, minimum: 0, maximum: 20 },
  atrPeriod: { type: 'integer' as const, minimum: 2, maximum: 100 },
  adxThreshold: { type: ['number', 'null'] as const, minimum: 0, maximum: 100 },
  adxPeriod: { type: 'integer' as const, minimum: 2, maximum: 100 },
};
const LEVER_FIELD_NAMES = [
  'buyConsensus', 'sellConsensus', 'recencyDays', 'persistenceBars',
  'minHoldingDays', 'atrPeriod', 'adxPeriod',
] as const;

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
        properties: LEVER_PROPERTIES,
        required: [...LEVER_FIELD_NAMES],
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
          'research. A confirmed exact date, if the research has one. If the research only gives an estimated ' +
          'date or range (e.g. "late October to early November"), resolve it to a single date by using the ' +
          "EARLIER end of that range. null only if the research gives no indication of timing at all; don't " +
          'invent a date with no basis in the research.',
      },
      nextEarningsDateSource: {
        type: ['string', 'null'] as const,
        description:
          'The domain of the source the research drew nextEarningsDate from (e.g. "investor.apple.com"), if ' +
          "attributable to one. null if nextEarningsDate is null, or you can't attribute it to a specific source.",
      },
      earningsOutlook: {
        type: 'string' as const,
        description:
          'What would merit success by the next earnings report and over the next year, per analysts/investors, ' +
          'and the consensus sentiment: highly positive, positive-but-cautious, negative-but-optimistic, or ' +
          'highly negative. Include a rough percentage range for the upside if expectations are met or beaten, ' +
          "and for the downside if they're missed, ONLY when the research actually supports an estimate; say " +
          "plainly when it doesn't rather than inventing a number.",
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
      rationaleClaims: {
        type: 'array' as const,
        items: {
          type: 'object' as const,
          properties: {
            claim: {
              type: 'string' as const,
              description:
                'A short, standalone synthesized claim from the research that supports rationale (e.g. "Google ' +
                'has historically overcome cloud-scaling challenges"), not a copy of rationale itself.',
            },
            citationIndices: {
              type: 'array' as const,
              items: { type: 'integer' as const, minimum: 0 },
              description: 'Indices into the numbered research citations list (given in the prompt) backing this specific claim.',
            },
          },
          required: ['claim', 'citationIndices'],
        },
        description:
          '0 or more distinct synthesized claims from the research that support rationale, each tied to a ' +
          'discrete part of the research (climate/changes, success criteria, likelihood, obstacles). Empty array ' +
          'if rationale is pure reasoning with nothing specific to break out as its own claim.',
      },
      fitReasonClaims: {
        type: 'array' as const,
        items: {
          type: 'object' as const,
          properties: {
            claim: { type: 'string' as const, description: 'Same as rationaleClaims, for fitReason.' },
            citationIndices: { type: 'array' as const, items: { type: 'integer' as const, minimum: 0 } },
          },
          required: ['claim', 'citationIndices'],
        },
        description: 'Same as rationaleClaims, for fitReason.',
      },
      earningsOutlookClaims: {
        type: 'array' as const,
        items: {
          type: 'object' as const,
          properties: {
            claim: { type: 'string' as const, description: 'Same as rationaleClaims, for earningsOutlook.' },
            citationIndices: { type: 'array' as const, items: { type: 'integer' as const, minimum: 0 } },
          },
          required: ['claim', 'citationIndices'],
        },
        description: 'Same as rationaleClaims, for earningsOutlook.',
      },
      earningsLikelihoodReasonClaims: {
        type: 'array' as const,
        items: {
          type: 'object' as const,
          properties: {
            claim: { type: 'string' as const, description: 'Same as rationaleClaims, for earningsLikelihoodReason.' },
            citationIndices: { type: 'array' as const, items: { type: 'integer' as const, minimum: 0 } },
          },
          required: ['claim', 'citationIndices'],
        },
        description: 'Same as rationaleClaims, for earningsLikelihoodReason.',
      },
    },
    required: [
      'rationale', 'settings', 'fit', 'fitReason',
      'nextEarningsDate', 'nextEarningsDateSource', 'earningsOutlook', 'earningsLikelihood', 'earningsLikelihoodReason',
      'rationaleClaims', 'fitReasonClaims', 'earningsOutlookClaims', 'earningsLikelihoodReasonClaims',
    ],
  },
};

/** Lets stage 2 validate a candidate settings combination against this
 * ticker's actual price history before finalizing with propose_settings,
 * instead of proposing settings from pure narrative reasoning with no
 * empirical check (see advisor.ts's scoreForRiskTolerance for the loop
 * that wires this in, and its system prompt for why this exists: a real
 * investigation found the majority of AI-proposed settings underperformed
 * both the plain default policy and buy-and-hold, from two failure modes
 * this tool is meant to let the model catch and correct on its own -
 * consensus/persistence loosened low enough to whipsaw a trending stock,
 * or several confirmation dials stacked restrictive enough to never
 * trade at all). */
export const RUN_BACKTEST_TOOL = {
  name: 'run_backtest',
  description:
    "Replays a candidate settings combination against this ticker's actual daily price history over the last " +
    '2 years and reports how a strategy trading purely on that signal would have performed, compared to simply ' +
    'buying and holding the same period. Use this to check a candidate before finalizing it with ' +
    'propose_settings: if it lost money, produced very few or zero trades, or badly lagged the reference ' +
    'numbers given in the prompt, the settings are likely miscalibrated for this specific ticker; revise them ' +
    'and check again rather than finalizing on a losing or non-functional candidate.',
  input_schema: {
    type: 'object' as const,
    properties: LEVER_PROPERTIES,
    required: [...LEVER_FIELD_NAMES],
  },
};

export interface BacktestCandidate {
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
  fieldCitations: FieldCitations;
  /** How the final proposed settings actually performed against this
   * ticker's real 2-year price history, from the same run_backtest
   * validation the model used to check its own work (see advisor.ts).
   * null when that final validation run itself failed (best-effort, non-
   * fatal; the proposal is still returned) or for a suggestion cached
   * before this field existed. Powers Historical Testing's scenario slot
   * without a separate "Run Testing" click. */
  backtestResult: BacktestResult | null;
}

/** The allowed range for each of the 9 tunable levers; mirrors
 * PROPOSE_SETTINGS_TOOL's and RUN_BACKTEST_TOOL's own declared bounds
 * exactly (see this file's header comment), and apps/api/src/routes/
 * backtest.ts's `clampOptions`. Exported so advisor.ts's run_backtest tool
 * handler clamps a candidate against the same bounds `propose_settings`
 * validates against, rather than a fourth hand-copied table. */
export const RANGES: Record<keyof ProposedSettings, [number, number]> = {
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

/** Resolves one field's raw claim array (as Claude returned it) against the
 * actual research citations list: each `{claim, citationIndices}` entry
 * becomes `{claim, quotes}`, dropping any out-of-range/malformed index
 * (an index a model got wrong is a minor cosmetic loss, not a reason to
 * fail the whole proposal) and any malformed entry entirely (missing/non-
 * string claim). A claim that resolves to zero quotes is still kept: research
 * built from a guided progression (likelihood, obstacles) is often the
 * model's own synthesis rather than a single directly-citable sentence, and
 * dropping it would silently delete real content, not just a citation. */
function resolveCitations(raw: unknown, citations: readonly ResearchQuote[]): FieldClaim[] {
  if (!Array.isArray(raw)) return [];
  const resolved: FieldClaim[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { claim, citationIndices } = entry as Record<string, unknown>;
    if (typeof claim !== 'string' || claim.trim().length === 0) continue;
    const quotes: ResearchQuote[] = [];
    if (Array.isArray(citationIndices)) {
      for (const i of citationIndices) {
        if (typeof i === 'number' && Number.isInteger(i) && i >= 0 && i < citations.length) {
          quotes.push(citations[i]!);
        }
      }
    }
    resolved.push({ claim: claim.trim(), quotes });
  }
  return resolved;
}

/** Validates a parsed `propose_settings` tool call input against the same
 * bounds the backend enforces. Throws with a specific message on the first
 * violation; the caller decides how to handle a model that ignored the
 * schema's declared bounds. `citations` is the same numbered list given to
 * the model in the prompt, used to resolve its claim fields' citation
 * indices into full FieldClaim objects. */
export function validateRiskScoredProposal(
  input: unknown,
  citations: readonly ResearchQuote[] = [],
  backtestResult: BacktestResult | null = null,
): RiskScoredProposal {
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
    fieldCitations: {
      rationale: resolveCitations(obj.rationaleClaims, citations),
      fitReason: resolveCitations(obj.fitReasonClaims, citations),
      earningsOutlook: resolveCitations(obj.earningsOutlookClaims, citations),
      earningsLikelihoodReason: resolveCitations(obj.earningsLikelihoodReasonClaims, citations),
    },
    backtestResult,
  };
}
