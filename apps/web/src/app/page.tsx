'use client';

import { useEffect, useRef, useState } from 'react';
import { recomputeReport } from '@stock-indicator-dailies/shared';
import type { Session } from '@supabase/supabase-js';
import { analyzeDaily, refreshDaily } from '@/lib/api';
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
import { AiSuggestionPanel } from '@/components/AiSuggestionPanel';
import { BacktestPanel, type BacktestPanelHandle } from '@/components/BacktestPanel';
import type { BacktestResult } from '@/types/backtest';
import { AuthPanel } from '@/components/AuthPanel';
import { SignalHistoryPanel } from '@/components/SignalHistoryPanel';
import { TabBar } from '@/components/TabBar';
import { defaultTabs, loadTabs, makeTabId, saveTabs, MAX_TABS, type TickerTab } from '@/lib/tickerTabs';

interface TabRuntime {
  loading: boolean;
  report: DailyReport | null;
  error: string | null;
  refreshing: boolean;
  refreshError: string | null;
  refreshAvailableAt: string | null;
}

function emptyRuntime(): TabRuntime {
  return { loading: false, report: null, error: null, refreshing: false, refreshError: null, refreshAvailableAt: null };
}

/** One tab's whole content area: the lookup box, Indicator Settings, and
 * (once looked up) the report + AI suggestion + backtest + history panels.
 * Every tab is rendered here and kept mounted, just hidden via `display`
 * while inactive -- switching tabs is instant and never re-triggers
 * AiSuggestionPanel's own cached-suggestion fetch or BacktestPanel's
 * baseline run, matching how a real browser tab keeps running in the
 * background instead of reloading when you switch back to it.
 *
 * The report-dependent panels are wrapped in their own `key` derived from
 * the *ticker actually loaded* (not just the tab), separate from this
 * outer block's own stable per-tab identity: replacing a tab's ticker in
 * place is a prop change on the same component instances, and at least
 * BacktestPanel only ever establishes its baseline once per mount (see its
 * own `[open]`-only effect) -- without a fresh key here, a replaced ticker
 * would keep showing the previous ticker's stale baseline/scenario. */
function TabContent({
  active,
  tab,
  runtime,
  liveSettings,
  session,
  onSubmit,
  onApplySettings,
  onRefresh,
}: {
  active: boolean;
  tab: TickerTab;
  runtime: TabRuntime;
  liveSettings: LiveSettings;
  session: Session | null;
  onSubmit: (ticker: string) => void;
  onApplySettings: (settings: LiveSettings) => void;
  onRefresh: () => void;
}) {
  const backtestRef = useRef<BacktestPanelHandle>(null);

  async function showSuggestionResult(settings: IndicatorSettings, result: BacktestResult) {
    await backtestRef.current?.showSuggestionResult(settings, result);
  }

  return (
    <div style={{ display: active ? 'block' : 'none' }}>
      <div className="section-label">Lookup Stock Analysis</div>
      <TickerInput onSubmit={onSubmit} disabled={runtime.loading} />
      <SettingsPanel settings={liveSettings} onApply={onApplySettings} />

      {runtime.loading && <LoadingState ticker={tab.ticker ?? ''} />}

      {runtime.error && (
        <div className="error-card">
          <h3>Analysis failed</h3>
          <p>{runtime.error}</p>
        </div>
      )}

      {runtime.report && (
        <div key={`${tab.id}:${runtime.report.ticker}`}>
          <ReportCard
            report={runtime.report}
            options={toLiveOptions(liveSettings)}
            onAddToWatchlist={
              session
                ? async () => {
                    const res = await addTicker(session.access_token, runtime.report!.ticker);
                    return res.ok ? { ok: true } : { ok: false, reason: res.reason };
                  }
                : undefined
            }
            refresh={{
              refreshAvailableAt: runtime.refreshAvailableAt,
              refreshing: runtime.refreshing,
              error: runtime.refreshError,
              onRefresh,
            }}
          />
          <AiSuggestionPanel
            ticker={runtime.report.ticker}
            settings={mergeSettings(liveSettings, DEFAULT_BACKTEST_ONLY_SETTINGS)}
            onApplyAsIndicatorSettings={onApplySettings}
            onSuggestionResult={showSuggestionResult}
          />
          <BacktestPanel ref={backtestRef} ticker={runtime.report.ticker} liveSettings={liveSettings} />
          <SignalHistoryPanel ticker={runtime.report.ticker} />
        </div>
      )}
    </div>
  );
}

export default function Home() {
  const { session } = useAuth();
  const [tabs, setTabs] = useState<TickerTab[]>(() => defaultTabs().tabs);
  const [activeId, setActiveId] = useState<string>(() => defaultTabs().activeId);
  const [runtime, setRuntime] = useState<Record<string, TabRuntime>>({});
  const [liveSettings, setLiveSettings] = useState<LiveSettings>(DEFAULT_LIVE_SETTINGS);
  // Guards the sessionStorage-write effect below against firing with the
  // pre-hydration default tabs before hydration itself has replaced them,
  // which would otherwise immediately clobber a real saved session.
  const hydrated = useRef(false);

  function getRuntime(id: string): TabRuntime {
    return runtime[id] ?? emptyRuntime();
  }

  function patchRuntime(id: string, patch: Partial<TabRuntime>) {
    setRuntime((prev) => ({ ...prev, [id]: { ...(prev[id] ?? emptyRuntime()), ...patch } }));
  }

  async function fetchTab(id: string, t: string, settings: LiveSettings) {
    patchRuntime(id, { loading: true, report: null, error: null });
    try {
      const result = await analyzeDaily(t);
      if (result.ok) {
        patchRuntime(id, { loading: false, report: recomputeReport(result.report, toLiveOptions(settings)) });
      } else {
        patchRuntime(id, { loading: false, error: dailyFailureMessage(result) });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network error';
      patchRuntime(id, { loading: false, error: `Failed while connecting to the analysis service: ${message}` });
    }
  }

  // Hydrate from sessionStorage after mount, not at initial render, so the
  // server-rendered and first client render both start from the same
  // defaults (avoids a hydration mismatch) -- same reasoning liveSettings
  // itself already followed. The 3 default tickers are normally cache-hot,
  // so eagerly fetching all of them (rather than waiting for a click) keeps
  // switching between them feeling instant.
  useEffect(() => {
    const settings = loadSettings();
    setLiveSettings(settings);
    const stored = loadTabs();
    setTabs(stored.tabs);
    setActiveId(stored.activeId);
    for (const tab of stored.tabs) {
      if (tab.ticker) void fetchTab(tab.id, tab.ticker, settings);
    }
    hydrated.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!hydrated.current) return;
    saveTabs({ tabs, activeId });
  }, [tabs, activeId]);

  function applySettings(newSettings: LiveSettings) {
    saveSettings(newSettings);
    setLiveSettings(newSettings);
    setRuntime((prev) => {
      const next: typeof prev = {};
      for (const [id, r] of Object.entries(prev)) {
        next[id] = r.report ? { ...r, report: recomputeReport(r.report, toLiveOptions(newSettings)) } : r;
      }
      return next;
    });
  }

  function handleSubmit(tabId: string, t: string) {
    const target = tabs.find((x) => x.id === tabId);
    if (!target || target.ticker === t) return; // no-op: same ticker re-looked-up in place
    setTabs((prev) => prev.map((x) => (x.id === tabId ? { ...x, ticker: t } : x)));
    void fetchTab(tabId, t, liveSettings);
  }

  function handleAddTab() {
    if (tabs.length >= MAX_TABS) return;
    const id = makeTabId();
    setTabs((prev) => [...prev, { id, ticker: null }]);
    setActiveId(id);
  }

  function handleCloseTab(id: string) {
    if (tabs.length <= 1) return; // the last remaining tab can't be closed
    const idx = tabs.findIndex((x) => x.id === id);
    const next = tabs.filter((x) => x.id !== id);
    setTabs(next);
    setRuntime((prev) => {
      const copy = { ...prev };
      delete copy[id];
      return copy;
    });
    if (activeId === id) {
      const fallback = next[idx] ?? next[next.length - 1]!;
      setActiveId(fallback.id);
    }
  }

  async function handleRefreshTab(id: string) {
    const tab = tabs.find((x) => x.id === id);
    if (!tab?.ticker) return;
    patchRuntime(id, { refreshing: true, refreshError: null });
    const { result, refreshAvailableAt, cooldown } = await refreshDaily(tab.ticker);
    if (result.ok) {
      patchRuntime(id, {
        refreshing: false,
        report: recomputeReport(result.report, toLiveOptions(liveSettings)),
        refreshAvailableAt,
        refreshError: null,
      });
    } else {
      patchRuntime(id, {
        refreshing: false,
        refreshAvailableAt: refreshAvailableAt ?? getRuntime(id).refreshAvailableAt,
        refreshError: cooldown ? 'This report was refreshed recently.' : 'Could not refresh. Try again in a moment.',
      });
    }
  }

  return (
    <div className="wrap">
      <h1 className="site-title">Stock Analysis Dailies</h1>
      <AuthPanel />

      <TabBar tabs={tabs} activeId={activeId} onSelect={setActiveId} onClose={handleCloseTab} onAdd={handleAddTab} />

      {tabs.map((tab) => (
        <TabContent
          key={tab.id}
          active={tab.id === activeId}
          tab={tab}
          runtime={getRuntime(tab.id)}
          liveSettings={liveSettings}
          session={session}
          onSubmit={(t) => handleSubmit(tab.id, t)}
          onApplySettings={applySettings}
          onRefresh={() => handleRefreshTab(tab.id)}
        />
      ))}
    </div>
  );
}
