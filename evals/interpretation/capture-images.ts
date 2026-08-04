/**
 * Capture-only pass — save the chart PNGs for hand-labeling WITHOUT any model
 * calls (free). Use this to produce evidence images for an existing CSV, or to
 * eyeball charts before spending on a billed eval.
 *
 *   npm run capture-images -w @stock-indicator-dailies/eval-interpretation -- GEV NVDA AAPL
 *
 * Drives a real browser (needs a live TradingView session) but calls no model.
 * Images land in ./eval-images/<TICKER>.png — the same path the CSV references.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { ChartAcquisitionError, TradingViewChartAgent } from '@stock-indicator-dailies/agent';

const tickers = process.argv.slice(2).map((t) => t.toUpperCase());

if (tickers.length === 0) {
  console.error('usage: npm run capture-images -w @stock-indicator-dailies/eval-interpretation -- TICKER [TICKER...]');
  process.exit(1);
}

const dir = path.resolve(process.env.INIT_CWD ?? process.cwd(), 'eval-images');
mkdirSync(dir, { recursive: true });

console.error(`\nCapturing ${tickers.length} chart(s) — no model calls, browser only.\n`);

const agent = new TradingViewChartAgent();
let saved = 0;
for (const ticker of tickers) {
  try {
    const image = await agent.acquire(ticker);
    const out = path.join(dir, `${ticker}.png`);
    writeFileSync(out, Buffer.from(image.base64, 'base64'));
    console.log(`  ✅ ${ticker.padEnd(6)} -> ${out}`);
    saved++;
  } catch (err) {
    console.error(`  ❌ ${ticker.padEnd(6)} ${err instanceof Error ? err.message : String(err)}`);
    // A rejected chart often still carries the image it was rejected on — save
    // it (clearly marked FAILED) so the failure can be verified by eye.
    if (err instanceof ChartAcquisitionError && err.image) {
      const out = path.join(dir, `${ticker}.FAILED.png`);
      writeFileSync(out, Buffer.from(err.image.base64, 'base64'));
      console.error(`     saved diagnostic image -> ${out}`);
    }
  }
}

console.log(`\n  ${saved}/${tickers.length} saved to ${dir}\n`);
