/**
 * One-time interactive login.
 *
 * Opens a real (headed) browser at the charting provider so YOU can sign in by
 * hand — including via Google SSO. The resulting session is persisted to the
 * profile directory and reused by every later agent run, so the agent never
 * handles a password and no automated sign-in is ever attempted.
 *
 *   npm run login -w @stock-indicator-dailies/agent
 *
 * The script polls for a real auth session and tells you the moment you're
 * signed in — a visible chart does NOT mean you're logged in, since TradingView
 * serves charts to anonymous visitors.
 */
import { chromium, type BrowserContext } from 'playwright';

import { TRADINGVIEW } from './profiles/tradingview.ts';
import { hasAuthSession } from './auth.ts';
import { resolveProfileDir } from './session.ts';

const profileDir = resolveProfileDir();

console.log(`Opening ${TRADINGVIEW.baseUrl}`);
console.log(`Profile:  ${profileDir}\n`);
console.log('  1. Click the user icon (top-right) or the ☰ menu → Sign in');
console.log('  2. Sign in with Google — same as you normally would');
console.log('  3. Wait for this script to print "SIGNED IN", then close the window\n');
console.log('NOTE: seeing a chart does NOT mean you are signed in — TradingView');
console.log('      shows charts to anonymous visitors too.\n');

const context = await chromium.launchPersistentContext(profileDir, {
  headless: false,
  viewport: { width: 1600, height: 1000 },
});

const page = context.pages()[0] ?? (await context.newPage());
await page.goto(TRADINGVIEW.chartUrl('NVDA'), { waitUntil: 'domcontentloaded' });

let closed = false;
context.on('close', () => (closed = true));

let announced = false;
const poll = setInterval(async () => {
  if (closed) return;
  try {
    if (await hasAuthSession(context as BrowserContext)) {
      if (!announced) {
        announced = true;
        console.log('✅ SIGNED IN — session captured. You can close the browser window now.');
      }
    } else if (announced) {
      announced = false;
      console.log('⚠️  Session went away (signed out?). Sign in again.');
    }
  } catch {
    // context closing mid-poll; ignore
  }
}, 2000);

// Capture final state just before the window goes away.
let signedInAtClose = false;
context.on('close', () => {
  clearInterval(poll);
});
await new Promise<void>((resolve) => {
  context.on('close', () => resolve());
});
signedInAtClose = announced;

clearInterval(poll);

if (signedInAtClose) {
  console.log(`\n✅ Session saved to ${profileDir}`);
  console.log('Future agent runs will reuse it. Re-run this if it ever expires.');
} else {
  console.log('\n❌ No signed-in session was detected before the window closed.');
  console.log('   Nothing is broken — just re-run and complete the sign-in.');
  process.exitCode = 1;
}
