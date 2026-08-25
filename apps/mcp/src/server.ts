import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import type { DailyReport } from '@stock-indicator-dailies/daily';

import { analyzeTicker } from './tools/analyzeTicker.ts';
import { recomputeSignal } from './tools/recomputeSignal.ts';

const server = new McpServer({ name: 'stock-indicator-dailies', version: '0.0.0' });

function jsonContent(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

/** The chart image is capture evidence, not something a text-based tool
 * caller acts on; dropping it keeps a single tool response from blowing
 * past a reasonable context budget. */
function withoutImage(report: DailyReport): Omit<DailyReport, 'image'> {
  const { image: _image, ...rest } = report;
  return rest;
}

server.registerTool(
  'analyze_ticker',
  {
    title: 'Analyze ticker',
    description:
      "Captures a ticker's daily chart and returns the full read: the AI/chart interpretation, the deterministic (computed) read, per-indicator readings, and timing/warnings. This is the base data source for every other workflow here.",
    inputSchema: { ticker: z.string().describe('Stock ticker, e.g. NVDA') },
  },
  async ({ ticker }) => {
    const result = await analyzeTicker(ticker);
    if (!result.ok) return jsonContent(result);
    return jsonContent({ ok: true, report: withoutImage(result.report) });
  },
);

server.registerTool(
  'recompute_signal',
  {
    title: 'Recompute signal at different sensitivity',
    description:
      'Rederives the overall signal from a report already returned by analyze_ticker, at different sensitivity thresholds. Pure and instant: no new capture. Pass the exact report object from a prior analyze_ticker call.',
    inputSchema: {
      report: z.any().describe('The report object exactly as returned by analyze_ticker (the "report" field of its ok:true result).'),
      buyConsensus: z.number().optional().describe('Minimum BUY-reading indicators required to emit BUY (default 2 of 3).'),
      sellConsensus: z.number().optional().describe('Minimum SELL-reading indicators required to emit SELL (default 3 of 3, unanimity).'),
      recencyDays: z.number().optional().describe('A crossover older than this many bars no longer counts (default 3).'),
    },
  },
  async ({ report, buyConsensus, sellConsensus, recencyDays }) => {
    const recomputed = recomputeSignal(report as DailyReport, { buyConsensus, sellConsensus, recencyDays });
    return jsonContent(withoutImage(recomputed));
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
