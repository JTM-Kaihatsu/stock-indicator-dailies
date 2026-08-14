'use client';

import { useEffect, useState } from 'react';
import { analyzeDaily } from '@/lib/api';
import type { DailyReport } from '@/types/api';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, toLiveOptions, type IndicatorSettings } from '@/lib/settings';
import { recomputeReport } from '@/lib/recompute';
import { TickerInput } from '@/components/TickerInput';
import { ReportCard } from '@/components/ReportCard';
import { LoadingState } from '@/components/LoadingState';
import { SettingsPanel } from '@/components/SettingsPanel';

export default function Home() {
  const [loading, setLoading] = useState(false);
  const [ticker, setTicker] = useState('');
  const [report, setReport] = useState<DailyReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<IndicatorSettings>(DEFAULT_SETTINGS);

  // Hydrate from sessionStorage after mount, not at initial render, so the
  // server-rendered and first client render both start from the same
  // defaults (avoids a hydration mismatch).
  useEffect(() => {
    setSettings(loadSettings());
  }, []);

  /** Single recompute path for both manual Apply and AI-suggestion accept. */
  function applySettings(newSettings: IndicatorSettings) {
    saveSettings(newSettings);
    setSettings(newSettings);
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
        setReport(recomputeReport(result.report, settings));
      } else {
        setError(`${result.stage}: ${result.reason}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="wrap">
      <SettingsPanel settings={settings} onApply={applySettings} />
      <TickerInput onSubmit={handleSubmit} disabled={loading} />

      {loading && <LoadingState ticker={ticker} />}

      {error && (
        <div className="error-card">
          <h3>Analysis failed</h3>
          <p>{error}</p>
        </div>
      )}

      {report && <ReportCard report={report} options={toLiveOptions(settings)} />}
    </div>
  );
}
