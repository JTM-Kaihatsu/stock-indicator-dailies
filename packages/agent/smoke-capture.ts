/**
 * Manual smoke test — drive the real browser and capture one chart.
 * Writes the PNG locally so you can eyeball what the VLM would receive.
 *
 *   node packages/agent/smoke-capture.ts NVDA
 */
import { writeFileSync } from 'node:fs';

import { TradingViewChartAgent } from './src/tradingview-agent.ts';
import { ChartAcquisitionError } from './src/agent.ts';

const ticker = process.argv[2] ?? 'NVDA';
const out = process.argv[3] ?? `testing/capture-${ticker.toLowerCase()}.png`;

const agent = new TradingViewChartAgent();
const started = Date.now();

try {
  const image = await agent.acquire(ticker);
  const bytes = Buffer.from(image.base64, 'base64');
  writeFileSync(out, bytes);
  console.log(`✅ captured ${ticker} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  console.log(`   ${bytes.length.toLocaleString()} bytes -> ${out}`);
} catch (err) {
  if (err instanceof ChartAcquisitionError) {
    console.error(`❌ ${err.reason}: ${err.message}`);
    process.exitCode = 1;
  } else {
    throw err;
  }
}
