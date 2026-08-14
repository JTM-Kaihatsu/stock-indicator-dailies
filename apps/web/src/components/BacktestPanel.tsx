'use client';

import { useState } from 'react';
import { runBacktest } from '@/lib/backtestApi';
import { toBacktestOptions, type IndicatorSettings } from '@/lib/settings';
import type { BacktestResult } from '@/types/backtest';
import { TradeList } from './TradeList';

const pct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;

export function BacktestPanel({ ticker, settings }: { ticker: string; settings: IndicatorSettings }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await runBacktest(ticker, toBacktestOptions(settings));
      if (res.ok) setResult(res.result);
      else setError(res.reason);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="backtest-panel">
      <div className="section-label">Historical testing</div>
      <button type="button" className="analyze-btn" onClick={run} disabled={loading}>
        {loading ? 'Running…' : 'Run Historical Test'}
      </button>

      {error && (
        <div className="error-card" style={{ marginTop: 12 }}>
          <h3>Backtest failed</h3>
          <p>{error}</p>
        </div>
      )}

      {result && (
        <>
          <div className="backtest-stats">
            <div className="backtest-stat">
              <div className="backtest-stat-label">Strategy return</div>
              <div className={`backtest-stat-value ${result.strategyReturnPct >= 0 ? 'pos' : 'neg'}`}>
                {pct(result.strategyReturnPct)}
              </div>
            </div>
            <div className="backtest-stat">
              <div className="backtest-stat-label">Buy &amp; hold</div>
              <div className={`backtest-stat-value ${result.buyAndHoldReturnPct >= 0 ? 'pos' : 'neg'}`}>
                {pct(result.buyAndHoldReturnPct)}
              </div>
            </div>
          </div>
          <div className="settings-group-hint">
            {result.startDate} → {result.endDate} ({result.barsUsed} bars)
            {result.stillHolding ? ' · still holding at end, marked to market' : ''}
          </div>
          <TradeList trades={result.trades} />
        </>
      )}
    </section>
  );
}
