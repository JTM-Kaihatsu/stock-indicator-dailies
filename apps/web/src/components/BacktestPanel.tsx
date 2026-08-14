'use client';

import { useEffect, useState } from 'react';
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
import { BacktestOnlySettingsFields, InfoIcon, LiveSettingsFields } from './SettingsFields';
import { AiSuggestionPanel } from './AiSuggestionPanel';

const pct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;

export function BacktestPanel({ ticker, liveSettings }: { ticker: string; liveSettings: LiveSettings }) {
  const [open, setOpen] = useState(false);
  // A local, sandboxed copy of the policy thresholds; starts from the
  // live report's current settings but is freely editable here without
  // touching the live report. Same "alternate universe" scoping as
  // backtestOnly below.
  const [policy, setPolicy] = useState<LiveSettings>(liveSettings);
  const [backtestOnly, setBacktestOnly] = useState<BacktestOnlySettings>(DEFAULT_BACKTEST_ONLY_SETTINGS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // First run becomes the fixed baseline; every run after that replaces the
  // scenario slot; one middle pellet at a time, never stacked. Both a
  // manual field edit + Run and an AI-suggestion Accept go through the same
  // path below.
  const [baseline, setBaseline] = useState<BacktestResult | null>(null);
  const [baselineSettings, setBaselineSettings] = useState<IndicatorSettings | null>(null);
  const [scenario, setScenario] = useState<BacktestResult | null>(null);
  const [scenarioSettings, setScenarioSettings] = useState<IndicatorSettings | null>(null);

  const currentSettings = mergeSettings(policy, backtestOnly);

  /** Fetches one backtest and surfaces an error, without touching
   * baseline/scenario slot state; callers decide where the result goes. */
  async function runFor(settings: IndicatorSettings): Promise<BacktestResult | null> {
    try {
      const res = await runBacktest(ticker, toBacktestOptions(settings));
      if (!res.ok) {
        setError(res.reason);
        return null;
      }
      return res.result;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
      return null;
    }
  }

  /** Establishes the baseline using the settings active in the report above
   * (default backtest-only filters, current live policy). Returns the
   * result so callers can chain a second run off it. Guarded by baseline
   * already being null, so it only ever runs once. */
  async function establishBaseline(): Promise<BacktestResult | null> {
    setLoading(true);
    setError(null);
    const defaultSettings = mergeSettings(liveSettings, DEFAULT_BACKTEST_ONLY_SETTINGS);
    const result = await runFor(defaultSettings);
    if (result) {
      setBaseline(result);
      setBaselineSettings(defaultSettings);
    }
    setLoading(false);
    return result;
  }

  // Auto-run the baseline as soon as the section opens. It always reflects
  // the settings active in the report above, so there is no reason to wait
  // for the user to click a button to see it.
  useEffect(() => {
    if (open && !baseline && !loading) {
      void establishBaseline();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function run() {
    setLoading(true);
    setError(null);
    const settings = mergeSettings(policy, backtestOnly);
    const result = await runFor(settings);
    if (result) {
      if (!baseline) {
        setBaseline(result);
        setBaselineSettings(settings);
      } else {
        setScenario(result);
        setScenarioSettings(settings);
      }
    }
    setLoading(false);
  }

  async function acceptAiSuggestion(proposed: IndicatorSettings) {
    const nextPolicy: LiveSettings = {
      buyConsensus: proposed.buyConsensus,
      sellConsensus: proposed.sellConsensus,
      recencyDays: proposed.recencyDays,
    };
    const nextBacktestOnly: BacktestOnlySettings = {
      persistenceBars: proposed.persistenceBars,
      minHoldingDays: proposed.minHoldingDays,
      atrMultiplier: proposed.atrMultiplier,
      atrPeriod: proposed.atrPeriod,
      adxThreshold: proposed.adxThreshold,
      adxPeriod: proposed.adxPeriod,
    };
    setPolicy(nextPolicy);
    setBacktestOnly(nextBacktestOnly);

    // The AI proposal always lands in the "Custom settings" slot, never
    // "Strategy return". That pellet means the settings active when the
    // report was generated, so if there is no baseline yet (e.g. the
    // auto-run above is still in flight or failed), establish it first.
    if (!baseline) {
      const baselineResult = await establishBaseline();
      if (!baselineResult) return;
    }

    setLoading(true);
    setError(null);
    const settings = mergeSettings(nextPolicy, nextBacktestOnly);
    const result = await runFor(settings);
    if (result) {
      setScenario(result);
      setScenarioSettings(settings);
    }
    setLoading(false);
  }

  return (
    <section className="backtest-panel">
      <button type="button" className="settings-toggle" onClick={() => setOpen((v) => !v)}>
        {open ? '▾' : '▸'} Historical Testing
      </button>

      {open && (
        <div style={{ marginTop: 12 }}>
          <div className="settings-group-hint">
            <p>
              It&apos;s time to time travel and make more money! Adjust how much money a given strategy would
              make by changing indicator-read settings and then simulating how this strategy would play out.
            </p>
            <p>
              Note that the settings below are backtest-only execution filters; these have no effect on the
              live report above.
            </p>
          </div>
          <LiveSettingsFields value={policy} onChange={setPolicy} idPrefix="bt-" />
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

          {!baseline && loading && (
            <div className="advisor-diff-empty" style={{ marginTop: 12 }}>
              Running the baseline test using the settings from the analysis above.
            </div>
          )}

          {baseline && (
            <>
              <div className="backtest-stats">
                <div className="backtest-stat">
                  <div className="backtest-stat-label" style={{ display: 'inline-flex', alignItems: 'center' }}>
                    Baseline Strategy Return
                    <InfoIcon text="Baseline uses indicator settings used in the main stock indicator analysis above." />
                  </div>
                  <div className={`backtest-stat-value ${baseline.strategyReturnPct >= 0 ? 'pos' : 'neg'}`}>
                    {pct(baseline.strategyReturnPct)}
                  </div>
                </div>
                <div className="backtest-stat">
                  <div className="backtest-stat-label">Custom Strategy Return</div>
                  {scenario ? (
                    <div className={`backtest-stat-value ${scenario.strategyReturnPct >= 0 ? 'pos' : 'neg'}`}>
                      {pct(scenario.strategyReturnPct)}
                    </div>
                  ) : (
                    <div className="backtest-stat-value backtest-stat-empty">N/A</div>
                  )}
                </div>
                <div className="backtest-stat">
                  <div className="backtest-stat-label">Buy &amp; Hold Return</div>
                  <div className={`backtest-stat-value ${baseline.buyAndHoldReturnPct >= 0 ? 'pos' : 'neg'}`}>
                    {pct(baseline.buyAndHoldReturnPct)}
                  </div>
                </div>
              </div>

              {scenario && scenarioSettings && baselineSettings && diffSettings(baselineSettings, scenarioSettings).length > 0 && (
                <div className="compare-card">
                  <div className="settings-group-title">Custom settings vs baseline</div>
                  {diffSettings(baselineSettings, scenarioSettings).map((f) => (
                    <div className="compare-row" key={f.key}>
                      <span className="compare-label">{f.label}</span>
                      <span className="compare-values">
                        {f.from ?? 'off'} <span className="compare-arrow">→</span> {f.to ?? 'off'}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <div className="section-label" style={{ marginTop: 16 }}>Baseline trades</div>
              <div className="settings-group-hint">
                {baseline.startDate} → {baseline.endDate} ({baseline.barsUsed} bars)
                {baseline.stillHolding ? ' · still holding at end, marked to market' : ''}
              </div>
              <TradeList result={baseline} />

              {scenario && (
                <>
                  <div className="section-label" style={{ marginTop: 16 }}>Custom settings trades</div>
                  <div className="settings-group-hint">
                    {scenario.startDate} → {scenario.endDate} ({scenario.barsUsed} bars)
                    {scenario.stillHolding ? ' · still holding at end, marked to market' : ''}
                  </div>
                  <TradeList result={scenario} />
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
