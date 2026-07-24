/**
 * Report whether the saved profile currently holds a signed-in session.
 *
 *   npm run status -w @stock-indicator-dailies/agent
 *
 * Prints cookie NAMES only — never values.
 */
import { chromium } from 'playwright';

import { hasAuthSession } from './auth.ts';
import { TRADINGVIEW } from './profiles/tradingview.ts';
import { profileExists, resolveProfileDir } from './session.ts';

const profileDir = resolveProfileDir();
console.log(`Profile: ${profileDir}`);

if (!profileExists(profileDir)) {
  console.log('❌ No profile yet. Run: npm run login -w @stock-indicator-dailies/agent');
  process.exit(1);
}

const context = await chromium.launchPersistentContext(profileDir, { headless: true });
try {
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(TRADINGVIEW.chartUrl('NVDA'), {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  await page.waitForTimeout(4000);

  const signedIn = await hasAuthSession(context);
  if (signedIn) {
    console.log('✅ SIGNED IN — the agent can use this session.');
  } else {
    console.log('❌ NOT signed in (no session cookie).');
    console.log('   Run: npm run login -w @stock-indicator-dailies/agent');
    process.exitCode = 1;
  }
} finally {
  await context.close();
}
