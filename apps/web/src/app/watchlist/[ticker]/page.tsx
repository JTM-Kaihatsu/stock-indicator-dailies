'use client';

import { use, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { recomputeReport } from '@stock-indicator-dailies/shared';
import { useAuth } from '@/hooks/useAuth';
import { fetchWatchlistTickerReport, updateScenarioSettings, updateWatchlistSettings } from '@/lib/watchlistApi';
import { sleep } from '@/lib/polling.ts';
import { DEFAULT_LIVE_SETTINGS, toLiveOptions, type IndicatorSettings, type LiveSettings } from '@/lib/settings';
import { stageLabel } from '@/lib/errorMessages';
import { ReportCard } from '@/components/ReportCard';
import { SettingsPanel } from '@/components/SettingsPanel';
import { BacktestPanel } from '@/components/BacktestPanel';
import { SignalHistoryPanel } from '@/components/SignalHistoryPanel';
import type { DailyReport } from '@/types/api';

// The server-side capture this may trigger isn't job/poll-tracked (it's
// fire-and-forget from the report endpoint itself), so this is a plain
// client-side poll rather than lib/polling.ts's pollUntilDone: a timeout
// here should just leave the page showing "waiting," not throw.
const POLL_INTERVAL_MS = 5000;
const POLL_MAX_MS = 5 * 60 * 1000;

/** The server stores scenario_settings opaquely (never interpreted
 * server-side); this is the one place that trusts its shape, guarded by a
 * minimal runtime check since it ultimately came from parseIndicatorSettings
 * on write. `null`/malformed both degrade to "nothing to restore." */
function toIndicatorSettings(raw: Record<string, unknown> | null): IndicatorSettings | null {
  if (!raw) return null;
  const required: Array<keyof IndicatorSettings> = ['buyConsensus', 'sellConsensus', 'recencyDays', 'persistenceBars', 'minHoldingDays', 'atrPeriod', 'adxPeriod'];
  if (!required.every((key) => typeof raw[key] === 'number')) return null;
  return raw as unknown as IndicatorSettings;
}

type Status =
  | { kind: 'loading' }
  | { kind: 'pending' }
  | { kind: 'failed'; stage: string; reason: string; userMessage?: string }
  | { kind: 'ready'; report: DailyReport; settings: LiveSettings; scenarioSettings: IndicatorSettings | null };

export default function WatchlistTickerPage({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = use(params);
  const { session, loading: authLoading } = useAuth();
  const [status, setStatus] = useState<Status>({ kind: 'loading' });
  const [settingsError, setSettingsError] = useState<string | null>(null);
  // Guards the poll loop below against a stale response landing after the
  // ticker changed (navigating from one watchlisted ticker's page to
  // another re-uses this same component instance).
  const requestId = useRef(0);

  useEffect(() => {
    if (!session) return;
    const myRequestId = ++requestId.current;
    setStatus({ kind: 'loading' });

    async function poll() {
      const deadline = Date.now() + POLL_MAX_MS;
      // First check happens immediately; this call is also what triggers a
      // retry server-side when there's no fresh cache (see
      // GET /watchlist/:ticker/report) — simply loading this page is the
      // "retry" the user asked for, no separate button needed.
      for (;;) {
        const res = await fetchWatchlistTickerReport(session!.access_token, ticker);
        if (requestId.current !== myRequestId) return; // ticker changed underneath us

        if (res.ok) {
          setStatus({
            kind: 'ready',
            report: res.report,
            settings: { ...DEFAULT_LIVE_SETTINGS, ...(res.settings ?? {}) },
            scenarioSettings: toIndicatorSettings(res.scenarioSettings),
          });
          return;
        }
        if (!res.pending) {
          setStatus({ kind: 'failed', stage: res.stage, reason: res.reason, userMessage: res.userMessage });
          return;
        }
        setStatus({ kind: 'pending' });
        if (Date.now() >= deadline) return;
        await sleep(POLL_INTERVAL_MS);
      }
    }

    void poll();
  }, [session, ticker]);

  /** Single source of truth for persisting this ticker's sensitivity
   * override, used by both the Indicator Settings panel below and
   * BacktestPanel's "Apply to stock watchlist settings" button — both
   * write to the exact same watchlist entry, so both go through here to
   * stay in sync. Recomputes the on-screen report immediately on success
   * rather than waiting for a re-fetch, same instant-feedback pattern as
   * the main page's own settings panel. */
  async function persistSettings(newSettings: LiveSettings): Promise<{ ok: boolean; reason?: string }> {
    if (!session || status.kind !== 'ready') return { ok: false, reason: 'Report not loaded yet.' };
    const res = await updateWatchlistSettings(session.access_token, ticker, newSettings);
    if (!res.ok) return { ok: false, reason: res.reason };
    setStatus((prev) =>
      prev.kind === 'ready'
        ? { ...prev, settings: newSettings, report: recomputeReport(prev.report, toLiveOptions(newSettings)) }
        : prev,
    );
    return { ok: true };
  }

  /** Persists this ticker's last-run scenario/custom Historical Testing
   * settings, called by BacktestPanel whenever a scenario run (manual or an
   * accepted AI suggestion) completes, so revisiting this page restores and
   * auto-reruns it instead of starting blank. Best-effort from the caller's
   * perspective: BacktestPanel doesn't surface a failure here since the
   * on-screen result is already correct either way. */
  function persistScenarioSettings(newSettings: IndicatorSettings) {
    if (!session) return;
    void updateScenarioSettings(session.access_token, ticker, newSettings as unknown as Record<string, unknown>);
  }

  function applySettings(newSettings: LiveSettings) {
    setSettingsError(null);
    void persistSettings(newSettings).then((result) => {
      if (!result.ok) setSettingsError(result.reason ?? 'Could not save these settings.');
    });
  }

  if (authLoading) return null;

  if (!session) {
    return (
      <div className="wrap">
        <h1 className="site-title">Stock Analysis Dailies</h1>
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
      <h1 className="site-title">Stock Analysis Dailies</h1>
      <Link href="/" className="auth-popover-link" style={{ marginTop: 0, marginBottom: 20 }}>
        ← Back
      </Link>

      {status.kind === 'loading' && <div className="settings-group-hint">Loading {ticker}...</div>}

      {status.kind === 'pending' && (
        <div className="settings-group-hint">Running {ticker}&apos;s analysis — this page will update automatically.</div>
      )}

      {status.kind === 'failed' && (
        <div className="error-card">
          <h3>{ticker} failed</h3>
          <p>
            {status.userMessage ?? `Failed while ${stageLabel(status.stage)}: ${status.reason}. It'll retry automatically the next time you load this page.`}
          </p>
        </div>
      )}

      {status.kind === 'ready' && (
        <>
          <ReportCard report={status.report} options={toLiveOptions(status.settings)} />

          <SettingsPanel settings={status.settings} onApply={applySettings} />
          {settingsError && (
            <div className="error-card" style={{ marginBottom: 20 }}>
              <p>{settingsError}</p>
            </div>
          )}

          <BacktestPanel
            ticker={ticker}
            liveSettings={status.settings}
            onApplyToWatchlist={persistSettings}
            initialScenarioSettings={status.scenarioSettings}
            onScenarioPersist={persistScenarioSettings}
          />
          <SignalHistoryPanel ticker={ticker} />
        </>
      )}
    </div>
  );
}
