'use client';

import { useEffect, useState } from 'react';
import { analyzeDaily } from '@/lib/api';
import type { DailyReport } from '@/types/api';
import { DEFAULT_LIVE_SETTINGS, loadSettings, saveSettings, toLiveOptions, type LiveSettings } from '@/lib/settings';
import { recomputeReport } from '@/lib/recompute';
import { dailyFailureMessage } from '@/lib/errorMessages';
import { TickerInput } from '@/components/TickerInput';
import { ReportCard } from '@/components/ReportCard';
import { LoadingState } from '@/components/LoadingState';
import { SettingsPanel } from '@/components/SettingsPanel';
import { BacktestPanel } from '@/components/BacktestPanel';

export default function Home() {
  const [loading, setLoading] = useState(false);
  const [ticker, setTicker] = useState('');
  const [report, setReport] = useState<DailyReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [liveSettings, setLiveSettings] = useState<LiveSettings>(DEFAULT_LIVE_SETTINGS);

  // Hydrate from sessionStorage after mount, not at initial render, so the
  // server-rendered and first client render both start from the same
  // defaults (avoids a hydration mismatch).
  useEffect(() => {
    setLiveSettings(loadSettings());
  }, []);

  function applySettings(newSettings: LiveSettings) {
    saveSettings(newSettings);
    setLiveSettings(newSettings);
    setReport((current) => (current ? recomputeReport(current, newSettings) : current));
  }

  async function handleSubmit(t: string) {
    setTicker(t);
    setLoading(true);
    setReport(null);
    setError(null);

    try {
      const result = await analyzeDaily(t);
      if (result.ok) {
        setReport(recomputeReport(result.report, liveSettings));
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
      <SettingsPanel settings={liveSettings} onApply={applySettings} />
      <TickerInput onSubmit={handleSubmit} disabled={loading} />

      {loading && <LoadingState ticker={ticker} />}

      {error && (
        <div className="error-card">
          <h3>Analysis failed</h3>
          <p>{error}</p>
        </div>
      )}

      {report && (
        <>
          <ReportCard report={report} options={toLiveOptions(liveSettings)} />
          <BacktestPanel ticker={report.ticker} liveSettings={liveSettings} />
        </>
      )}
    </div>
  );
}
