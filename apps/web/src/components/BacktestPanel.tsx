'use client';

import { useState } from 'react';
import { runBacktest } from '@/lib/backtestApi';
import {
  DEFAULT_BACKTEST_ONLY_SETTINGS,
  diffSettings,
  mergeSettings,
  toBacktestOptions,
  type BacktestOnlySettings,
  type IndicatorSettings,
  type LiveSettings,
} from '@/lib/settings';
import type { BacktestResult } from '@/types/backtest';
import { TradeList } from './TradeList';
import { BacktestOnlySettingsFields } from './SettingsFields';
import { AiSuggestionPanel } from './AiSuggestionPanel';

const pct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;

export function BacktestPanel({ ticker, liveSettings }: { ticker: string; liveSettings: LiveSettings }) {
  const [open, setOpen] = useState(false);
  const [backtestOnly, setBacktestOnly] = useState<BacktestOnlySettings>(DEFAULT_BACKTEST_ONLY_SETTINGS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // First run becomes the fixed baseline; every run after that replaces the
  // scenario slot — one middle pellet at a time, never stacked. Both a
  // manual field edit + Run and an AI-suggestion Accept go through the same
  // path below.
  const [baseline, setBaseline] = useState<BacktestResult | null>(null);
  const [baselineSettings, setBaselineSettings] = useState<IndicatorSettings | null>(null);
  const [scenario, setScenario] = useState<BacktestResult | null>(null);
  const [scenarioSettings, setScenarioSettings] = useState<IndicatorSettings | null>(null);

  const currentSettings = mergeSettings(liveSettings, backtestOnly);

  async function runWith(nextBacktestOnly: BacktestOnlySettings) {
    setBacktestOnly(nextBacktestOnly);
    setLoading(true);
    setError(null);
    const settings = mergeSettings(liveSettings, nextBacktestOnly);
    try {
      const res = await runBacktest(ticker, toBacktestOptions(settings));
      if (!res.ok) {
        setError(res.reason);
        return;
      }
      if (!baseline) {
        setBaseline(res.result);
        setBaselineSettings(settings);
      } else {
        setScenario(res.result);
        setScenarioSettings(settings);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }

  function run() {
    return runWith(backtestOnly);
  }

  function acceptAiSuggestion(proposed: IndicatorSettings) {
    const nextBacktestOnly: BacktestOnlySettings = {
      persistenceBars: proposed.persistenceBars,
      minHoldingDays: proposed.minHoldingDays,
      atrMultiplier: proposed.atrMultiplier,
      atrPeriod: proposed.atrPeriod,
      adxThreshold: proposed.adxThreshold,
      adxPeriod: proposed.adxPeriod,
    };
    return runWith(nextBacktestOnly);
  }

  return (
    <section className="backtest-panel">
      <button type="button" className="settings-toggle" onClick={() => setOpen((v) => !v)}>
        {open ? '▾' : '▸'} Historical Testing
      </button>

      {open && (
        <div style={{ marginTop: 12 }}>
          <div className="settings-group-hint">
            Backtest-only execution filters — these have no effect on the live report above.
          </div>
          <BacktestOnlySettingsFields value={backtestOnly} onChange={setBacktestOnly} />

          <div style={{ marginTop: 12 }}>
            <button type="button" className="analyze-btn" onClick={run} disabled={loading}>
              {loading ? 'Running…' : 'Run Historical Test'}
            </button>
          </div>

          {error && (
            <div className="error-card" style={{ marginTop: 12 }}>
              <h3>Backtest failed</h3>
              <p>{error}</p>
            </div>
          )}

          {!baseline && !loading && !error && (
            <div className="advisor-diff-empty" style={{ marginTop: 12 }}>
              Uninitialized — adjust settings above and run to see results.
            </div>
          )}

          {baseline && (
            <>
              <div className="backtest-stats">
                <div className="backtest-stat">
                  <div className="backtest-stat-label">Strategy return</div>
                  <div className={`backtest-stat-value ${baseline.strategyReturnPct >= 0 ? 'pos' : 'neg'}`}>
                    {pct(baseline.strategyReturnPct)}
                  </div>
                </div>
                <div className="backtest-stat">
                  <div className="backtest-stat-label">Custom settings</div>
                  {scenario ? (
                    <>
                      <div className={`backtest-stat-value ${scenario.strategyReturnPct >= 0 ? 'pos' : 'neg'}`}>
                        {pct(scenario.strategyReturnPct)}
                      </div>
                      {scenarioSettings && baselineSettings && (
                        <div className="backtest-stat-delta">
                          {diffSettings(baselineSettings, scenarioSettings).length} setting(s) changed vs baseline
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="backtest-stat-value backtest-stat-empty">—</div>
                  )}
                </div>
                <div className="backtest-stat">
                  <div className="backtest-stat-label">Buy &amp; hold</div>
                  <div className={`backtest-stat-value ${baseline.buyAndHoldReturnPct >= 0 ? 'pos' : 'neg'}`}>
                    {pct(baseline.buyAndHoldReturnPct)}
                  </div>
                </div>
              </div>

              <div className="section-label" style={{ marginTop: 16 }}>Baseline trades</div>
              <div className="settings-group-hint">
                {baseline.startDate} → {baseline.endDate} ({baseline.barsUsed} bars)
                {baseline.stillHolding ? ' · still holding at end, marked to market' : ''}
              </div>
              <TradeList trades={baseline.trades} />

              {scenario && (
                <>
                  <div className="section-label" style={{ marginTop: 16 }}>Custom settings trades</div>
                  <div className="settings-group-hint">
                    {scenario.startDate} → {scenario.endDate} ({scenario.barsUsed} bars)
                    {scenario.stillHolding ? ' · still holding at end, marked to market' : ''}
                  </div>
                  <TradeList trades={scenario.trades} />
                </>
              )}
            </>
          )}

          <AiSuggestionPanel ticker={ticker} settings={currentSettings} onAccept={acceptAiSuggestion} />
        </div>
      )}
    </section>
  );
}
