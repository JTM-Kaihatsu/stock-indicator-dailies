import { Hono } from 'hono';

import { getRecentHistory } from '../signalHistory.ts';
import { parseTicker } from '../ticker.ts';

export const historyRoute = new Hono();

// Public, no auth: this is the same visibility level as /api/daily itself
// (a signal history for a ticker isn't personal data), unlike /api/watchlist.
historyRoute.get('/history/:ticker', async (c) => {
  const ticker = parseTicker(c.req.param('ticker'));
  if (!ticker) return c.json({ ok: false, reason: 'Invalid ticker' }, 400);

  const entries = await getRecentHistory(ticker);
  return c.json({ ok: true, entries });
});
