import type { BacktestResult } from '@stock-indicator-dailies/eval-backtest';

export type { BacktestOptions, BacktestResult, Trade } from '@stock-indicator-dailies/eval-backtest';

export type BacktestResponse =
  | { ok: true; result: BacktestResult }
  | { ok: false; reason: string };
