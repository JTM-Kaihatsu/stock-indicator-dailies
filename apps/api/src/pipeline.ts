import { TradingViewChartAgent } from '@stock-indicator-dailies/agent';
import { runDaily, type DailyResult } from '@stock-indicator-dailies/daily';
import { ClaudeVlmProvider } from '@stock-indicator-dailies/vlm';

import { cacheReport, getCachedReport, logFailure } from './cache.ts';

let agent: TradingViewChartAgent | undefined;
let provider: ClaudeVlmProvider | undefined;
let busy = false;

function ensureInitialized() {
  agent ??= new TradingViewChartAgent();
  provider ??= new ClaudeVlmProvider();
}

export function isBusy(): boolean {
  return busy;
}

export async function runPipeline(ticker: string): Promise<DailyResult> {
  // Cache check happens before the browser-automation path entirely — a hit
  // skips Playwright and the VLM call, and doesn't contend with the busy lock.
  const cached = await getCachedReport(ticker);
  if (cached) return { ok: true, report: cached };

  if (busy) throw new PipelineBusyError();
  ensureInitialized();
  busy = true;
  try {
    const result = await runDaily({ ticker, agent: agent!, provider: provider! });
    if (result.ok) {
      await cacheReport(result.report);
    } else {
      await logFailure(ticker, result);
    }
    return result;
  } finally {
    busy = false;
  }
}

export class PipelineBusyError extends Error {
  constructor() {
    super('A pipeline run is already in progress');
    this.name = 'PipelineBusyError';
  }
}
