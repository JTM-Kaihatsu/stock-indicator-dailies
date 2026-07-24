/**
 * One-time interactive login.
 *
 * Opens a real (headed) browser at the charting provider so YOU can sign in by
 * hand — including via Google SSO. The resulting session is persisted to the
 * profile directory and reused by every later agent run, so the agent never
 * handles a password and no automated sign-in is ever attempted.
 *
 *   npm run login -w @stock-indicator-dailies/agent
 */
import { chromium } from 'playwright';

import { TRADINGVIEW } from './profiles/tradingview.ts';
import { resolveProfileDir } from './session.ts';

const profileDir = resolveProfileDir();

console.log(`Opening ${TRADINGVIEW.baseUrl} with profile: ${profileDir}`);
console.log('\nSign in however you normally do (Google SSO is fine).');
console.log('When you are signed in and see your chart, close the browser window.\n');

const context = await chromium.launchPersistentContext(profileDir, {
  headless: false,
  viewport: { width: 1600, height: 1000 },
});

const page = context.pages()[0] ?? (await context.newPage());
await page.goto(TRADINGVIEW.chartUrl('NVDA'), { waitUntil: 'domcontentloaded' });

// Stay open until the user closes the window.
await new Promise<void>((resolve) => context.on('close', () => resolve()));

console.log(`\nSession saved to ${profileDir}`);
console.log('Future agent runs will reuse it. Re-run this if the session expires.');
