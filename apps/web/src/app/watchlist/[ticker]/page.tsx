'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/hooks/useAuth';
import { fetchWatchlistTickerReport } from '@/lib/watchlistApi';
import { DEFAULT_LIVE_SETTINGS, toLiveOptions, type LiveSettings } from '@/lib/settings';
import { ReportCard } from '@/components/ReportCard';
import { BacktestPanel } from '@/components/BacktestPanel';
import { SignalHistoryPanel } from '@/components/SignalHistoryPanel';
import type { DailyReport } from '@/types/api';

type Status =
  | { kind: 'loading' }
  | { kind: 'pending' }
  | { kind: 'error'; reason: string }
  | { kind: 'ready'; report: DailyReport; settings: LiveSettings };

export default function WatchlistTickerPage({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = use(params);
  const { session, loading: authLoading } = useAuth();
  const [status, setStatus] = useState<Status>({ kind: 'loading' });

  useEffect(() => {
    if (!session) return;
    setStatus({ kind: 'loading' });
    fetchWatchlistTickerReport(session.access_token, ticker).then((res) => {
      if (!res.ok) {
        if (res.pending) setStatus({ kind: 'pending' });
        else setStatus({ kind: 'error', reason: res.reason });
        return;
      }
      setStatus({ kind: 'ready', report: res.report, settings: { ...DEFAULT_LIVE_SETTINGS, ...(res.settings ?? {}) } });
    });
  }, [session, ticker]);

  if (authLoading) return null;

  if (!session) {
    return (
      <div className="wrap">
        <h1 className="site-title">Daily Stock Analysis</h1>
        <div className="settings-panel">
          <div className="settings-group-hint">
            Sign in from the home page to view this. <Link href="/" className="auth-popover-link" style={{ display: 'inline', marginTop: 0 }}>← Back</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="wrap">
      <h1 className="site-title">Daily Stock Analysis</h1>
      <Link href="/" className="auth-popover-link" style={{ marginTop: 0, marginBottom: 20 }}>
        ← Back
      </Link>

      {status.kind === 'loading' && <div className="settings-group-hint">Loading {ticker}...</div>}

      {status.kind === 'pending' && (
        <div className="settings-group-hint">
          {ticker} hasn&apos;t been captured yet; it&apos;ll show up here once the first run completes.
        </div>
      )}

      {status.kind === 'error' && (
        <div className="error-card">
          <h3>Couldn&apos;t load {ticker}</h3>
          <p>{status.reason}</p>
        </div>
      )}

      {status.kind === 'ready' && (
        <>
          <ReportCard report={status.report} options={toLiveOptions(status.settings)} />
          <BacktestPanel ticker={ticker} liveSettings={status.settings} />
          <SignalHistoryPanel ticker={ticker} />
        </>
      )}
    </div>
  );
}
