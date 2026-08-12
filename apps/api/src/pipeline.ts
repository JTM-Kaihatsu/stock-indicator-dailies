import { TradingViewChartAgent } from '@stock-indicator-dailies/agent';
import { runDaily, type DailyResult } from '@stock-indicator-dailies/daily';
import { ClaudeVlmProvider } from '@stock-indicator-dailies/vlm';

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
  if (busy) throw new PipelineBusyError();
  ensureInitialized();
  busy = true;
  try {
    return await runDaily({ ticker, agent: agent!, provider: provider! });
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
