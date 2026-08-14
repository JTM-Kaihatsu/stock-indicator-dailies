'use client';

import { useState } from 'react';
import { runBacktest } from '@/lib/backtestApi';
import { toBacktestOptions, type IndicatorSettings } from '@/lib/settings';
import type { BacktestResult } from '@/types/backtest';
import { TradeList } from './TradeList';
import { ScenarioForm } from './ScenarioForm';
import { CompareCard } from './CompareCard';

const pct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;

export function BacktestPanel({ ticker, settings }: { ticker: string; settings: IndicatorSettings }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Comparison state — only one open/active at a time by construction: opening
  // the form always replaces prior scenario state, never stacks.
  const [comparing, setComparing] = useState(false);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [scenario, setScenario] = useState<{ settings: IndicatorSettings; baseline: BacktestResult; result: BacktestResult } | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    setResult(null);
    setScenario(null);
    setComparing(false);
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

  function openCompare() {
    setScenario(null);
    setCompareError(null);
    setComparing(true);
  }

  async function runComparison(scenarioSettings: IndicatorSettings) {
    setCompareLoading(true);
    setCompareError(null);
    try {
      const [baselineRes, scenarioRes] = await Promise.all([
        runBacktest(ticker, toBacktestOptions(settings)),
        runBacktest(ticker, toBacktestOptions(scenarioSettings)),
      ]);
      if (!baselineRes.ok) return setCompareError(baselineRes.reason);
      if (!scenarioRes.ok) return setCompareError(scenarioRes.reason);
      setScenario({ settings: scenarioSettings, baseline: baselineRes.result, result: scenarioRes.result });
      setComparing(false);
    } catch (err) {
      setCompareError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setCompareLoading(false);
    }
  }

  return (
    <section className="backtest-panel">
      <div className="section-label">Historical testing</div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="analyze-btn" onClick={run} disabled={loading}>
          {loading ? 'Running…' : 'Run Historical Test'}
        </button>
        {result && (
          <button type="button" className="settings-toggle" onClick={openCompare} disabled={compareLoading}>
            Compare Different Settings
          </button>
        )}
      </div>

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

      {comparing && (
        <ScenarioForm
          initial={settings}
          onRun={runComparison}
          onCancel={() => setComparing(false)}
          running={compareLoading}
        />
      )}

      {compareError && (
        <div className="error-card" style={{ marginTop: 12 }}>
          <h3>Comparison failed</h3>
          <p>{compareError}</p>
        </div>
      )}

      {scenario && (
        <CompareCard
          baselineSettings={settings}
          scenarioSettings={scenario.settings}
          baseline={scenario.baseline}
          scenario={scenario.result}
        />
      )}
    </section>
  );
}
