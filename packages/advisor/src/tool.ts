/**
 * Fixed tool schemas for the advisor loop. Bounds mirror
 * apps/api/src/routes/backtest.ts's `clampOptions` exactly, so client-,
 * model-, and server-side bounds on the same 9 fields never drift apart.
 */

export const WEB_SEARCH_TOOL = {
  type: 'web_search_20250305' as const,
  name: 'web_search' as const,
  max_uses: 5,
};

export const PROPOSE_SETTINGS_TOOL = {
  name: 'propose_settings',
  description:
    'Propose specific indicator-lever setting changes for this ticker, with a rationale grounded in your research. Call this exactly once, as your final action, after you are done researching.',
  input_schema: {
    type: 'object' as const,
    properties: {
      rationale: {
        type: 'string' as const,
        description: '2-4 sentence explanation grounded in the researched industry/trends/news/competitors.',
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
    },
    required: ['rationale', 'settings'],
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
 * violation — the caller decides how to handle a model that ignored the
 * schema's declared bounds. */
export function validateProposedSettings(input: unknown): { rationale: string; settings: ProposedSettings } {
  if (typeof input !== 'object' || input === null) {
    throw new Error('propose_settings input was not an object');
  }
  const obj = input as Record<string, unknown>;
  if (typeof obj.rationale !== 'string' || obj.rationale.trim().length === 0) {
    throw new Error('propose_settings missing a non-empty rationale');
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

  return { rationale: obj.rationale, settings: settings as unknown as ProposedSettings };
}
