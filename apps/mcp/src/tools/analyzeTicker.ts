import { TradingViewChartAgent } from '@stock-indicator-dailies/agent';
import { runDaily, type DailyResult } from '@stock-indicator-dailies/daily';
import { ClaudeVlmProvider } from '@stock-indicator-dailies/vlm';

import { SerialQueue } from '../queue.ts';

// Module-level singletons, same posture as apps/api/src/pipeline.ts: cheap
// wrapper objects, not a resident browser (TradingViewChartAgent opens and
// closes its own context per capture). Reused across calls within one MCP
// server process so a series of tool calls (e.g. a related-ticker scan)
// doesn't reconstruct them each time.
let agent: TradingViewChartAgent | undefined;
let provider: ClaudeVlmProvider | undefined;
const queue = new SerialQueue();

/** Captures and interprets one ticker's chart. Serialized: TradingView
 * login state lives in a single on-disk browser profile, so only one
 * capture can run at a time. */
export async function analyzeTicker(ticker: string): Promise<DailyResult> {
  return queue.run(() => {
    agent ??= new TradingViewChartAgent();
    provider ??= new ClaudeVlmProvider();
    return runDaily({ ticker, agent: agent!, provider: provider! });
  });
}
