import { Hono } from 'hono';
import { yahooDataSource } from '@stock-indicator-dailies/indicators';
import { runBacktest, type BacktestOptions } from '@stock-indicator-dailies/eval-backtest';

import { parseTicker } from '../ticker.ts';

/**
 * Regression-testing endpoint: replay the deterministic policy over real
 * history for a ticker and report whether following it would have beaten
 * buy-and-hold. Pure computation over Yahoo OHLC data; no Playwright, no
 * VLM call; so unlike /api/daily this stays well within any request
 * timeout even for a multi-year range; no job/poll pattern needed here.
 *
 * Not yet wired into the frontend (tooling ahead of a future FE page); see
 * evals/backtest for the CLI equivalent.
 */
export const backtestRoute = new Hono();

interface BacktestBody {
  ticker?: string;
  range?: string;
  options?: BacktestOptions;
}

const RANGE_PATTERN = /^\d+[dmoy]$|^ytd$|^max$/;

/** Clamp a caller-supplied option to a sane range so this endpoint can't be
 * pushed into pathological (e.g. negative period, million-bar) computation. */
function clampOptions(raw: BacktestOptions | undefined): BacktestOptions {
  if (!raw) return {};
  const clamp = (v: unknown, min: number, max: number): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : undefined;

  const options: BacktestOptions = {};
  const buyConsensus = clamp(raw.buyConsensus, 1, 3);
  const sellConsensus = clamp(raw.sellConsensus, 1, 3);
  const recencyDays = clamp(raw.recencyDays, 1, 60);
  const persistenceBars = clamp(raw.persistenceBars, 1, 30);
  const minHoldingDays = clamp(raw.minHoldingDays, 0, 365);
  const atrMultiplier = clamp(raw.atrMultiplier, 0, 20);
  const atrPeriod = clamp(raw.atrPeriod, 2, 100);
  const adxThreshold = clamp(raw.adxThreshold, 0, 100);
  const adxPeriod = clamp(raw.adxPeriod, 2, 100);
  if (buyConsensus !== undefined) options.buyConsensus = buyConsensus;
  if (sellConsensus !== undefined) options.sellConsensus = sellConsensus;
  if (recencyDays !== undefined) options.recencyDays = recencyDays;
  if (persistenceBars !== undefined) options.persistenceBars = persistenceBars;
  if (minHoldingDays !== undefined) options.minHoldingDays = minHoldingDays;
  if (atrMultiplier !== undefined) options.atrMultiplier = atrMultiplier;
  if (atrPeriod !== undefined) options.atrPeriod = atrPeriod;
  if (adxThreshold !== undefined) options.adxThreshold = adxThreshold;
  if (adxPeriod !== undefined) options.adxPeriod = adxPeriod;
  return options;
}

backtestRoute.post('/backtest', async (c) => {
  const body = await c.req.json<BacktestBody>().catch(() => ({}) as BacktestBody);
  const ticker = parseTicker(body.ticker);
  if (!ticker) {
    return c.json({ ok: false, reason: 'Invalid or missing ticker' }, 400);
  }
  const range = body.range && RANGE_PATTERN.test(body.range) ? body.range : '2y';
  const options = clampOptions(body.options);

  try {
    const bars = await yahooDataSource.fetchDailyBars(ticker, range);
    const result = runBacktest(ticker, bars, options);
    return c.json({ ok: true, result });
  } catch (err) {
    return c.json({ ok: false, reason: err instanceof Error ? err.message : String(err) }, 502);
  }
});
