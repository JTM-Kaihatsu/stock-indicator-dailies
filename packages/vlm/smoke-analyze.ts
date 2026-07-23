/**
 * Manual smoke test — feed one real chart PNG through the full VLM pipeline.
 * Makes a live, billed Anthropic call. Run from the repo root:
 *
 *   node --env-file=.env.local packages/vlm/smoke-analyze.ts <image.png> <TICKER>
 */
import { readFileSync } from 'node:fs';

import { ClaudeVlmProvider } from './src/providers/claude.ts';
import { analyzeChart } from './src/analyze.ts';

const imagePath = process.argv[2] ?? 'testing/gev-chart-cropped.png';
const ticker = process.argv[3] ?? 'GEV';

const base64 = readFileSync(imagePath).toString('base64');
const provider = new ClaudeVlmProvider();

console.log(`Analyzing ${ticker} from ${imagePath} …\n`);
const result = await analyzeChart({
  ticker,
  image: { base64, mediaType: 'image/png' },
  provider,
});

console.log('--- raw model output ---');
console.log(result.raw);
console.log('\n--- result ---');
if (result.ok) {
  console.log(`SIGNAL: ${result.verdict.signal}`);
  for (const r of result.verdict.readings) {
    console.log(`  ${r.indicator.padEnd(16)} ${r.signal}${r.rationale ? ` — ${r.rationale}` : ''}`);
  }
  if (result.warnings.length) console.log('warnings:', result.warnings);
} else {
  console.log('ERRORS:', result.errors);
}
