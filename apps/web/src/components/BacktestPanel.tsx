'use client';

import { useEffect, useRef, useState } from 'react';
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
import { AiSuggestionPanel, type AcceptResult } from './AiSuggestionPanel';

type RunOutcome = { ok: true; result: BacktestResult } | { ok: false; reason: string };

const pct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;

export function BacktestPanel({
  ticker,
  liveSettings,
  onApplyToWatchlist,
  initialScenarioSettings,
  onScenarioPersist,
}: {
  ticker: string;
  liveSettings: LiveSettings;
  /** Only passed when this panel is rendered for a watchlisted ticker;
   * persists the currently-configured policy (buy/sell/recency, the same
   * 3 fields LiveSettingsFields edits above) as that ticker's stored
   * sensitivity override. Omitted on the ad-hoc main-page report, where
   * there's no watchlist entry to save to. */
  onApplyToWatchlist?: (settings: LiveSettings) => Promise<{ ok: boolean; reason?: string }>;
  /** A watchlisted ticker's last-saved scenario/custom run, if any; used to
   * auto-rerun the same comparison once the baseline is established, so
   * revisiting the ticker's page restores what was last seen instead of
   * starting blank. Omitted on the main page, which has nowhere to persist
   * a scenario against. */
  initialScenarioSettings?: IndicatorSettings | null;
  /** Called whenever a scenario successfully completes (manual Run or an
   * accepted AI suggestion), so the watchlisted ticker's stored scenario
   * stays current. Omitted on the main page. */
  onScenarioPersist?: (settings: IndicatorSettings) => void;
}) {
  // Open by default: Historical Testing is core to the report, not an
  // optional aside, on both the ad-hoc main-page report and a watchlisted
  // ticker's page.
  const [open, setOpen] = useState(true);
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

  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  // Guards the scenario auto-rerun below so it only ever fires once per
  // mount, even though it depends on `baseline` becoming available first.
  const scenarioAutoRunAttempted = useRef(false);

  const currentSettings = mergeSettings(policy, backtestOnly);

  /** Fetches one backtest, without touching baseline/scenario/error state;
   * callers decide where a result goes and whether/how to surface a
   * failure (the generic banner here, or routed to the AI Suggestion
   * panel when the run was triggered by accepting a suggestion). */
  async function runFor(settings: IndicatorSettings): Promise<RunOutcome> {
    try {
      const res = await runBacktest(ticker, toBacktestOptions(settings));
      if (!res.ok) return { ok: false, reason: res.reason };
      return { ok: true, result: res.result };
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : 'Network error' };
    }
  }

  /** Establishes the baseline using the settings active in the report above
   * (default backtest-only filters, current live policy). Returns the
   * outcome so callers can chain a second run off it. Guarded by baseline
   * already being null, so it only ever runs once. Always surfaces its own
   * failure via the generic banner (unlike the scenario run triggered by
   * an AI-suggestion accept): the baseline is foundational to the whole
   * section, not something specific to the AI Suggestion panel. */
  async function establishBaseline(): Promise<RunOutcome> {
    setLoading(true);
    setError(null);
    const defaultSettings = mergeSettings(liveSettings, DEFAULT_BACKTEST_ONLY_SETTINGS);
    const outcome = await runFor(defaultSettings);
    if (outcome.ok) {
      setBaseline(outcome.result);
      setBaselineSettings(defaultSettings);
    } else {
      setError(outcome.reason);
    }
    setLoading(false);
    return outcome;
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

  function splitSettings(settings: IndicatorSettings): { policy: LiveSettings; backtestOnly: BacktestOnlySettings } {
    return {
      policy: { buyConsensus: settings.buyConsensus, sellConsensus: settings.sellConsensus, recencyDays: settings.recencyDays },
      backtestOnly: {
        persistenceBars: settings.persistenceBars,
        minHoldingDays: settings.minHoldingDays,
        atrMultiplier: settings.atrMultiplier,
        atrPeriod: settings.atrPeriod,
        adxThreshold: settings.adxThreshold,
        adxPeriod: settings.adxPeriod,
      },
    };
  }

  // Once the baseline is established, restore and rerun the last-saved
  // scenario (if any), so revisiting a watchlisted ticker's page reproduces
  // the same custom-vs-baseline comparison the user last saw instead of
  // starting blank. Only ever attempted once per mount.
  useEffect(() => {
    if (!baseline || !initialScenarioSettings || scenarioAutoRunAttempted.current || loading) return;
    scenarioAutoRunAttempted.current = true;
    const { policy: nextPolicy, backtestOnly: nextBacktestOnly } = splitSettings(initialScenarioSettings);
    setPolicy(nextPolicy);
    setBacktestOnly(nextBacktestOnly);
    void (async () => {
      setLoading(true);
      const outcome = await runFor(initialScenarioSettings);
      if (outcome.ok) {
        setScenario(outcome.result);
        setScenarioSettings(initialScenarioSettings);
      }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseline, initialScenarioSettings, loading]);

  async function applyToWatchlist() {
    if (!onApplyToWatchlist) return;
    setApplying(true);
    setApplyError(null);
    const result = await onApplyToWatchlist(policy);
    setApplying(false);
    if (result.ok) setApplied(true);
    else setApplyError(result.reason ?? 'Could not save these settings.');
  }

  async function run() {
    setLoading(true);
    setError(null);
    setApplied(false);
    setApplyError(null);
    const settings = mergeSettings(policy, backtestOnly);
    const outcome = await runFor(settings);
    if (outcome.ok) {
      if (!baseline) {
        setBaseline(outcome.result);
        setBaselineSettings(settings);
      } else {
        setScenario(outcome.result);
        setScenarioSettings(settings);
        onScenarioPersist?.(settings);
      }
    } else {
      setError(outcome.reason);
    }
    setLoading(false);
  }

  /** Triggered by "Accept AI Suggestion". A failure here is reported by the
   * AI Suggestion panel itself, not the generic banner above: everything
   * already on screen (overall read, baseline) stays exactly as it was, and
   * the failure is scoped to "this specific suggestion couldn't be tested,"
   * not "Historical Testing is broken." */
  async function acceptAiSuggestion(proposed: IndicatorSettings): Promise<AcceptResult> {
    const { policy: nextPolicy, backtestOnly: nextBacktestOnly } = splitSettings(proposed);
    setPolicy(nextPolicy);
    setBacktestOnly(nextBacktestOnly);
    setApplied(false);
    setApplyError(null);

    // The AI proposal always lands in the "Custom settings" slot, never
    // "Strategy return". That pellet means the settings active when the
    // report was generated, so if there is no baseline yet (e.g. the
    // auto-run above is still in flight or failed), establish it first.
    if (!baseline) {
      const baselineOutcome = await establishBaseline();
      if (!baselineOutcome.ok) return { ok: false, reason: baselineOutcome.reason };
    }

    setLoading(true);
    const settings = mergeSettings(nextPolicy, nextBacktestOnly);
    const outcome = await runFor(settings);
    setLoading(false);
    if (!outcome.ok) return { ok: false, reason: outcome.reason };
    setScenario(outcome.result);
    setScenarioSettings(settings);
    onScenarioPersist?.(settings);
    return { ok: true };
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

              {onApplyToWatchlist && (
                <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
                  <button type="button" className="settings-toggle" onClick={applyToWatchlist} disabled={applying}>
                    {applying ? 'Saving…' : 'Apply to stock watchlist settings'}
                  </button>
                  {applied && !applying && <span className="badge settings-badge-active">Saved ✓</span>}
                </div>
              )}
              {applyError && (
                <div className="error-card" style={{ marginTop: 12 }}>
                  <p>{applyError}</p>
                </div>
              )}

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
