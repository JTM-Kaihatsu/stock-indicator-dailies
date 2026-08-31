import test from 'node:test';
import assert from 'node:assert/strict';

import { MIN_PLOT_PIXELS, isPaneUnpainted } from '../src/pane-paint.ts';

// Real numbers, not invented: measured live against real, painted MACD and
// Slow Stochastic panes across three tickers (AVGO, NVDA, TSLA) — each came
// back with 1500-3000+ pixels near the plot's blue/orange line colors. The
// browser-dependent half (findUnpaintedPanes, getContentPaneBounds) isn't
// unit-tested here — this package's tests never launch a real browser —
// but the decision it feeds into is, anchored to what was actually
// observed.

test('a painted pane (real measured counts) is not flagged', () => {
  assert.equal(isPaneUnpainted(1542, 1291), false); // MACD pane, AVGO
  assert.equal(isPaneUnpainted(2760, 2459), false); // Stochastic pane, AVGO
});

test('a pane with neither line color present is flagged', () => {
  assert.equal(isPaneUnpainted(0, 0), true);
});

test('a pane missing just one of the two lines is still flagged', () => {
  assert.equal(isPaneUnpainted(2000, 0), true);
  assert.equal(isPaneUnpainted(0, 2000), true);
});

test('the threshold sits with wide margin below any real painted count', () => {
  assert.equal(isPaneUnpainted(MIN_PLOT_PIXELS - 1, MIN_PLOT_PIXELS - 1), true);
  assert.equal(isPaneUnpainted(MIN_PLOT_PIXELS + 1, MIN_PLOT_PIXELS + 1), false);
});
