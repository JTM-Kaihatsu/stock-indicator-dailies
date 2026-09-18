'use client';

import { useEffect, useRef, useState } from 'react';
import { recomputeReport } from '@stock-indicator-dailies/shared';
import { analyzeDaily } from '@/lib/api';
import { addTicker } from '@/lib/watchlistApi';
import { useAuth } from '@/hooks/useAuth';
import type { DailyReport } from '@/types/api';
import {
  DEFAULT_BACKTEST_ONLY_SETTINGS,
  DEFAULT_LIVE_SETTINGS,
  loadSettings,
  mergeSettings,
  saveSettings,
  toLiveOptions,
  type IndicatorSettings,
  type LiveSettings,
} from '@/lib/settings';
import { dailyFailureMessage } from '@/lib/errorMessages';
import { TickerInput } from '@/components/TickerInput';
import { ReportCard } from '@/components/ReportCard';
import { LoadingState } from '@/components/LoadingState';
import { SettingsPanel } from '@/components/SettingsPanel';
import { AiSuggestionPanel, type AcceptResult } from '@/components/AiSuggestionPanel';
import { BacktestPanel, type BacktestPanelHandle } from '@/components/BacktestPanel';
import { AuthPanel } from '@/components/AuthPanel';
import { SignalHistoryPanel } from '@/components/SignalHistoryPanel';

export default function Home() {
  const { session } = useAuth();
  const [loading, setLoading] = useState(false);
  const [ticker, setTicker] = useState('');
  const [report, setReport] = useState<DailyReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [liveSettings, setLiveSettings] = useState<LiveSettings>(DEFAULT_LIVE_SETTINGS);
  const backtestRef = useRef<BacktestPanelHandle>(null);

  // Hydrate from sessionStorage after mount, not at initial render, so the
  // server-rendered and first client render both start from the same
  // defaults (avoids a hydration mismatch).
  useEffect(() => {
    setLiveSettings(loadSettings());
  }, []);

  function applySettings(newSettings: LiveSettings) {
    saveSettings(newSettings);
    setLiveSettings(newSettings);
    setReport((current) => (current ? recomputeReport(current, toLiveOptions(newSettings)) : current));
  }

  async function runTesting(settings: IndicatorSettings): Promise<AcceptResult> {
    if (!backtestRef.current) return { ok: false, reason: 'Historical Testing is not ready yet.' };
    return backtestRef.current.runScenario(settings);
  }

  async function handleSubmit(t: string) {
    setTicker(t);
    setLoading(true);
    setReport(null);
    setError(null);

    try {
      const result = await analyzeDaily(t);
      if (result.ok) {
        setReport(recomputeReport(result.report, toLiveOptions(liveSettings)));
      } else {
        setError(dailyFailureMessage(result));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network error';
      setError(`Failed while connecting to the analysis service: ${message}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="wrap">
      <h1 className="site-title">Stock Analysis Dailies</h1>
      <AuthPanel />

      <div className="section-label">Lookup Stock Analysis</div>
      <TickerInput onSubmit={handleSubmit} disabled={loading} />
      <SettingsPanel settings={liveSettings} onApply={applySettings} />

      {loading && <LoadingState ticker={ticker} />}

      {error && (
        <div className="error-card">
          <h3>Analysis failed</h3>
          <p>{error}</p>
        </div>
      )}

      {report && (
        <>
          <ReportCard
            report={report}
            options={toLiveOptions(liveSettings)}
            onAddToWatchlist={
              session
                ? async () => {
                    const res = await addTicker(session.access_token, report.ticker);
                    return res.ok ? { ok: true } : { ok: false, reason: res.reason };
                  }
                : undefined
            }
          />
          <AiSuggestionPanel
            ticker={report.ticker}
            settings={mergeSettings(liveSettings, DEFAULT_BACKTEST_ONLY_SETTINGS)}
            onApplyAsIndicatorSettings={applySettings}
            onAccept={runTesting}
          />
          <BacktestPanel ref={backtestRef} ticker={report.ticker} liveSettings={liveSettings} />
          <SignalHistoryPanel ticker={report.ticker} />
        </>
      )}
    </div>
  );
}
