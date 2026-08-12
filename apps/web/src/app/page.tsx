'use client';

import { useState } from 'react';
import { analyzeDaily } from '@/lib/api';
import type { DailyReport } from '@/types/api';
import { TickerInput } from '@/components/TickerInput';
import { ReportCard } from '@/components/ReportCard';
import { LoadingState } from '@/components/LoadingState';

export default function Home() {
  const [loading, setLoading] = useState(false);
  const [ticker, setTicker] = useState('');
  const [report, setReport] = useState<DailyReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(t: string) {
    setTicker(t);
    setLoading(true);
    setReport(null);
    setError(null);

    try {
      const result = await analyzeDaily(t);
      if (result.ok) {
        setReport(result.report);
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
      <TickerInput onSubmit={handleSubmit} disabled={loading} />

      {loading && <LoadingState ticker={ticker} />}

      {error && (
        <div className="error-card">
          <h3>Analysis failed</h3>
          <p>{error}</p>
        </div>
      )}

      {report && <ReportCard report={report} />}
    </div>
  );
}
