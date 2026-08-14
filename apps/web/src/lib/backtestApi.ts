import type { BacktestOptions, BacktestResponse } from '@/types/backtest';
import { apiUrl } from './api.ts';

/** Single-shot; no job/poll needed, the backtest endpoint is pure
 * computation and returns well within any reasonable timeout. */
export async function runBacktest(ticker: string, options: BacktestOptions, range = '2y'): Promise<BacktestResponse> {
  const res = await fetch(apiUrl('/api/backtest'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticker, range, options }),
  });
  return res.json();
}
