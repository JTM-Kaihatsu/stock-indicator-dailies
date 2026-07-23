import {
  parseVerdict,
  type ParseVerdictOptions,
  type Verdict,
} from '@stock-indicator-dailies/shared';

import { extractJson } from './extract.ts';
import { buildSystemPrompt, buildUserInstruction } from './prompt.ts';
import type { ChartImage, VlmProvider } from './provider.ts';

export interface AnalyzeChartInput {
  /** Ticker under analysis; treated as authoritative (see below). */
  ticker: string;
  image: ChartImage;
  provider: VlmProvider;
}

export type AnalyzeChartResult =
  | { ok: true; verdict: Verdict; warnings: string[]; raw: string }
  | { ok: false; errors: string[]; raw: string };

/**
 * Turn one raw model response into a validated result. The requested `ticker`
 * is injected as authoritative — we asked about a specific symbol, so we never
 * depend on the model echoing it back correctly. The rest flows through
 * {@link parseVerdict}, which recomputes the overall signal from the readings.
 */
export function interpretChartResponse(
  raw: string,
  context: { ticker: string },
  options: ParseVerdictOptions = {},
): AnalyzeChartResult {
  const json = extractJson(raw);
  if (json === null) {
    return { ok: false, errors: ['no JSON object found in model output'], raw };
  }

  const candidate =
    typeof json === 'object' && json !== null && !Array.isArray(json)
      ? { ...(json as Record<string, unknown>), ticker: context.ticker }
      : json;

  const result = parseVerdict(candidate, options);
  return result.ok
    ? { ok: true, verdict: result.verdict, warnings: result.warnings, raw }
    : { ok: false, errors: result.errors, raw };
}

/**
 * Full analysis for one chart: build the prompt, call the provider, and
 * interpret the response. The provider is the only part that touches the
 * network / the actual model.
 */
export async function analyzeChart(
  input: AnalyzeChartInput,
  options: ParseVerdictOptions = {},
): Promise<AnalyzeChartResult> {
  const request = {
    systemPrompt: buildSystemPrompt(),
    userInstruction: buildUserInstruction(input.ticker),
    image: input.image,
  };
  const raw = await input.provider.complete(request);
  return interpretChartResponse(raw, { ticker: input.ticker }, options);
}
