import test from 'node:test';
import assert from 'node:assert/strict';

import { AVG_LUMINANCE_THRESHOLD, DARK_PIXEL_FRACTION_THRESHOLD, isSuspiciousPixelProfile } from '../src/pixel-popup.ts';

// Real numbers, not invented: measured live via a debug script running the
// actual canvas-decode logic against real captures. The browser-dependent
// pixel-sampling half (looksLikePopupOverlay) isn't unit-tested here — this
// package's tests never launch a real browser — but the decision it feeds
// into is, anchored to what was actually observed.
const CLEAN_CAPTURES = [
  { ticker: 'NVDA', avgLuminance: 244.25, darkFraction: 0.0016 },
  { ticker: 'TSLA', avgLuminance: 246.54, darkFraction: 0 },
  { ticker: 'GOOGL', avgLuminance: 246.56, darkFraction: 0 },
  { ticker: 'META', avgLuminance: 245.74, darkFraction: 0 },
];

// A ~18%-of-frame simulated black rectangle drawn over a real clean capture
// (a conservative stand-in for the "End of Summer sale" modal that actually
// reached a report — that one covered noticeably more of the chart).
const SIMULATED_POPUP = { avgLuminance: 199.87, darkFraction: 0.182 };

test('real, popup-free captures are never flagged', () => {
  for (const { ticker, ...stats } of CLEAN_CAPTURES) {
    assert.equal(isSuspiciousPixelProfile(stats), false, `${ticker} should not be flagged`);
  }
});

test('a large dark overlay is flagged', () => {
  assert.equal(isSuspiciousPixelProfile(SIMULATED_POPUP), true);
});

test('dark-pixel fraction alone can trigger it', () => {
  assert.equal(isSuspiciousPixelProfile({ avgLuminance: 245, darkFraction: DARK_PIXEL_FRACTION_THRESHOLD + 0.01 }), true);
  assert.equal(isSuspiciousPixelProfile({ avgLuminance: 245, darkFraction: DARK_PIXEL_FRACTION_THRESHOLD - 0.01 }), false);
});

test('low average luminance alone can trigger it', () => {
  assert.equal(isSuspiciousPixelProfile({ avgLuminance: AVG_LUMINANCE_THRESHOLD - 1, darkFraction: 0 }), true);
  assert.equal(isSuspiciousPixelProfile({ avgLuminance: AVG_LUMINANCE_THRESHOLD + 1, darkFraction: 0 }), false);
});
