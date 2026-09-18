'use client';

import { Fragment, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/hooks/useAuth';
import {
  addTicker,
  fetchNotificationPrefs,
  fetchWatchlist,
  removeTicker,
  reorderWatchlist,
  setNotificationPrefs,
  updatePosition,
  updateWatchlistSettings,
} from '@/lib/watchlistApi';
import { DEFAULT_LIVE_SETTINGS, isDefault, type LiveSettings } from '@/lib/settings';
import { LiveSettingsFields } from '@/components/SettingsFields';
import type { WatchlistDashboardRow, WatchlistPosition } from '@/types/watchlist';

const TICKER_PATTERN = /^[A-Z]{1,5}(\.[A-Z]{1,2})?$/;
const pct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
const usd = (n: number) => `$${n.toFixed(2)}`;

function resolvedSettings(row: WatchlistDashboardRow): LiveSettings {
  return { ...DEFAULT_LIVE_SETTINGS, ...(row.settings ?? {}) };
}

export default function ManageWatchlistPage() {
  const { session, loading } = useAuth();
  const [rows, setRows] = useState<WatchlistDashboardRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [newTicker, setNewTicker] = useState('');
  const [newSettings, setNewSettings] = useState<LiveSettings>(DEFAULT_LIVE_SETTINGS);
  const [adding, setAdding] = useState(false);

  const [editingTicker, setEditingTicker] = useState<string | null>(null);
  const [editSettings, setEditSettings] = useState<LiveSettings>(DEFAULT_LIVE_SETTINGS);
  const [editEntryDate, setEditEntryDate] = useState('');
  const [editShares, setEditShares] = useState('');
  const [editEntryPrice, setEditEntryPrice] = useState('');
  const [saving, setSaving] = useState(false);

  const [dragTicker, setDragTicker] = useState<string | null>(null);

  // null while loading; the checkbox stays disabled until this resolves so
  // a click can't race the initial fetch and flip back to the server's
  // stale answer.
  const [emailOnSignal, setEmailOnSignalState] = useState<boolean | null>(null);
  const [savingNotif, setSavingNotif] = useState(false);
  const [notifError, setNotifError] = useState<string | null>(null);

  // Keyed on the user id, not the `session` object itself; see the longer
  // comment on the equivalent effect in watchlist/[ticker]/page.tsx. Here the
  // symptom is milder (a silent redundant re-fetch on every tab refocus,
  // not a visible reset to a loading state, since nothing here clears rows
  // first) but it's the same unnecessary work for the same reason.
  useEffect(() => {
    if (!session) return;
    fetchWatchlist(session.access_token).then((res) => {
      if (res.ok) setRows(res.rows);
      else setError(res.reason);
    });
    fetchNotificationPrefs(session.access_token).then((res) => {
      if (res.ok) setEmailOnSignalState(res.emailOnSignal);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- session is used
    // (via the closure) but deliberately not a dependency; see above.
  }, [session?.user?.id]);

  async function handleToggleNotifications(checked: boolean) {
    if (!session) return;
    setSavingNotif(true);
    setNotifError(null);
    const res = await setNotificationPrefs(session.access_token, checked);
    setSavingNotif(false);
    if (res.ok) setEmailOnSignalState(res.emailOnSignal);
    else setNotifError(res.reason);
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!session) return;
    const ticker = newTicker.trim().toUpperCase();
    if (!ticker || !TICKER_PATTERN.test(ticker)) return;

    setAdding(true);
    setError(null);
    const settingsToSend = isDefault(newSettings) ? undefined : newSettings;
    const res = await addTicker(session.access_token, ticker, settingsToSend);
    setAdding(false);
    if (!res.ok) {
      setError(res.reason);
      return;
    }

    setNewTicker('');
    setNewSettings(DEFAULT_LIVE_SETTINGS);
    setRows((prev) => {
      const withoutDuplicate = (prev ?? []).filter((r) => r.ticker !== ticker);
      return [
        ...withoutDuplicate,
        {
          ticker, overall: null, computed: null, ai: null, asOf: null, status: 'running', lastChangedAt: null,
          settings: settingsToSend ?? null, position: null, positionRisk: null, overallOverrideReason: null, unrealizedPnl: null,
        },
      ];
    });
  }

  async function handleRemove(ticker: string) {
    if (!session) return;
    setRows((prev) => (prev ?? []).filter((r) => r.ticker !== ticker));
    if (editingTicker === ticker) setEditingTicker(null);
    await removeTicker(session.access_token, ticker);
  }

  function openEditor(row: WatchlistDashboardRow) {
    setEditingTicker(row.ticker);
    setEditSettings(resolvedSettings(row));
    setEditEntryDate(row.position?.entryDate ?? '');
    setEditShares(row.position?.shares?.toString() ?? '');
    setEditEntryPrice(row.position?.entryPrice?.toString() ?? '');
  }

  function closeEditor() {
    setEditingTicker(null);
  }

  /** Native HTML5 drag-and-drop: no extra dependency needed for a single
   * flat list. `dragTicker` tracks which row is being dragged; dropping
   * reorders the local array optimistically, then persists the full new
   * order. `onDragOver`'s preventDefault is required for onDrop to fire at
   * all — that's a browser API quirk, not something specific to this code. */
  function handleDragStart(ticker: string) {
    setDragTicker(ticker);
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
  }

  async function handleDrop(targetTicker: string) {
    const dragged = dragTicker;
    setDragTicker(null);
    if (!session || !dragged || dragged === targetTicker) return;

    setRows((prev) => {
      const current = prev ?? [];
      const fromIndex = current.findIndex((r) => r.ticker === dragged);
      const toIndex = current.findIndex((r) => r.ticker === targetTicker);
      if (fromIndex === -1 || toIndex === -1) return current;
      const next = [...current];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved!);
      void reorderWatchlist(session.access_token, next.map((r) => r.ticker));
      return next;
    });
  }

  /** `undefined` means "leave the stored position alone" (all 3 fields
   * blank); `'invalid'` means some but not all 3 fields are filled;
   * otherwise a position to save or, with all 3 blank on a ticker that
   * already had one, null to clear it. */
  function parseEditPosition(): WatchlistPosition | null | undefined | 'invalid' {
    const hasAny = editEntryDate.trim() !== '' || editShares.trim() !== '' || editEntryPrice.trim() !== '';
    if (!hasAny) return undefined;
    const sharesNum = Number(editShares);
    const priceNum = Number(editEntryPrice);
    if (!editEntryDate || !Number.isFinite(sharesNum) || sharesNum <= 0 || !Number.isFinite(priceNum) || priceNum <= 0) {
      return 'invalid';
    }
    return { entryDate: editEntryDate, shares: sharesNum, entryPrice: priceNum };
  }

  async function saveEditor(ticker: string) {
    if (!session) return;
    const editingRow = (rows ?? []).find((r) => r.ticker === ticker);
    const hadPosition = !!editingRow?.position;
    const position = parseEditPosition() ?? (hadPosition ? null : undefined);
    if (position === 'invalid') {
      setError('Enter a valid entry date, a positive share count, and a positive entry price, or leave all three blank.');
      return;
    }

    setSaving(true);
    setError(null);
    const res = await updateWatchlistSettings(session.access_token, ticker, editSettings);
    if (res.ok && position !== undefined) {
      const posRes = await updatePosition(session.access_token, ticker, position);
      if (!posRes.ok) {
        setSaving(false);
        setError(posRes.reason);
        return;
      }
    }
    setSaving(false);
    if (!res.ok) {
      setError(res.reason);
      return;
    }
    setRows((prev) =>
      (prev ?? []).map((r) => (r.ticker === ticker ? { ...r, settings: editSettings, position: position === undefined ? r.position : position } : r)),
    );
    setEditingTicker(null);
  }

  if (loading) return null;

  if (!session) {
    return (
      <div className="wrap">
        <h1 className="site-title">Stock Analysis Dailies</h1>
        <div className="settings-panel">
          <div className="settings-group-hint">
            Sign in from the home page to manage your watchlist. <Link href="/" className="auth-popover-link" style={{ display: 'inline', marginTop: 0 }}>← Back</Link>
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

      {rows && rows.some((r) => r.position) && (
        <div className="settings-panel" style={{ marginBottom: 20 }}>
          <div className="section-label">Positions at risk</div>
          <div className="settings-group-hint" style={{ marginBottom: 12 }}>
            Every ticker with a recorded position, sell points first.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {rows
              .filter((r): r is WatchlistDashboardRow & { position: WatchlistPosition } => !!r.position)
              .sort((a, b) => Number(b.positionRisk?.triggered ?? false) - Number(a.positionRisk?.triggered ?? false))
              .map((row) => (
                <Link
                  key={row.ticker}
                  href={`/watchlist/${row.ticker}`}
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                    padding: '8px 12px', borderRadius: 8, textDecoration: 'none', color: 'inherit',
                    background: row.positionRisk?.triggered ? 'var(--sell-bg)' : 'transparent',
                    border: `1px solid ${row.positionRisk?.triggered ? 'var(--sell)' : 'var(--border)'}`,
                  }}
                >
                  <span style={{ fontWeight: 700, fontFamily: 'var(--mono)' }}>{row.ticker}</span>
                  <span className="fact">
                    {row.position.shares} sh @ {usd(row.position.entryPrice)} since {row.position.entryDate}
                  </span>
                  {row.unrealizedPnl && (
                    <span className="fact" style={{ color: row.unrealizedPnl.amount >= 0 ? 'var(--buy)' : 'var(--sell)' }}>
                      {row.unrealizedPnl.amount >= 0 ? '+' : ''}
                      {usd(row.unrealizedPnl.amount)} ({pct(row.unrealizedPnl.pct)})
                    </span>
                  )}
                  {row.positionRisk ? (
                    <span className="fact" style={{ color: row.positionRisk.triggered ? 'var(--sell)' : 'var(--muted)' }}>
                      {row.positionRisk.triggered ? 'Sell point breached' : `Sell point ${usd(row.positionRisk.stopLevel)}`}
                    </span>
                  ) : (
                    <span className="fact">Enable ATR to track a sell point</span>
                  )}
                </Link>
              ))}
          </div>
        </div>
      )}

      <div className="settings-panel">
        <div className="section-label">Manage Watchlist</div>

        <div className="settings-field" style={{ marginBottom: 20 }}>
          <label htmlFor="emailOnSignal">
            Email me when a watchlisted stock signals BUY or SELL
          </label>
          <input
            id="emailOnSignal"
            type="checkbox"
            checked={emailOnSignal ?? false}
            disabled={emailOnSignal === null || savingNotif}
            onChange={(e) => handleToggleNotifications(e.target.checked)}
          />
        </div>
        <div className="settings-group-hint" style={{ marginTop: -12, marginBottom: 20 }}>
          One digest email a day, after the morning sweep, covering your whole watchlist. Uses
          each ticker&apos;s own sensitivity settings below, same as what the dashboard shows.
        </div>
        {notifError && (
          <div className="error-card" style={{ marginBottom: 20 }}>
            <p>{notifError}</p>
          </div>
        )}

        <form onSubmit={handleAdd} style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <input
            type="text"
            className="ticker-input"
            style={{ fontSize: 18, width: 140 }}
            placeholder="NVDA"
            value={newTicker}
            onChange={(e) => setNewTicker(e.target.value)}
            disabled={adding}
            maxLength={6}
          />
          <button type="submit" className="analyze-btn" disabled={adding || !newTicker.trim()}>
            {adding ? 'Adding...' : 'Add to watchlist'}
          </button>
        </form>

        <div className="settings-group-hint" style={{ marginBottom: 4 }}>
          Sensitivity for this new ticker (defaults apply unless you change these):
        </div>
        <LiveSettingsFields value={newSettings} onChange={setNewSettings} idPrefix="new-" />

        {error && (
          <div className="error-card" style={{ marginTop: 16 }}>
            <p>{error}</p>
          </div>
        )}

        <div style={{ marginTop: 24 }}>
          {rows === null ? (
            <div className="settings-group-hint">Loading your watchlist...</div>
          ) : rows.length === 0 ? (
            <div className="settings-group-hint">No tickers yet. Add one above to start tracking it daily.</div>
          ) : (
            <table className="trade-list">
              <thead>
                <tr>
                  <th />
                  <th>Ticker</th>
                  <th>Sensitivity</th>
                  <th />
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const editing = editingTicker === row.ticker;
                  return (
                    <Fragment key={row.ticker}>
                      <tr
                        draggable
                        onDragStart={() => handleDragStart(row.ticker)}
                        onDragOver={handleDragOver}
                        onDrop={() => handleDrop(row.ticker)}
                        style={{ opacity: dragTicker === row.ticker ? 0.4 : 1 }}
                      >
                        <td className="drag-handle" aria-label={`Drag to reorder ${row.ticker}`} title="Drag to reorder">
                          ☰
                        </td>
                        <td className="tabular" style={{ fontWeight: 700 }}>{row.ticker}</td>
                        <td className="fact">{row.settings && !isDefault(resolvedSettings(row)) ? 'Custom' : 'Default'}</td>
                        <td>
                          <button type="button" className="settings-toggle" onClick={() => (editing ? closeEditor() : openEditor(row))}>
                            {editing ? '▾' : '▸'} Edit settings
                          </button>
                        </td>
                        <td>
                          <button type="button" className="settings-toggle" onClick={() => handleRemove(row.ticker)} aria-label={`Remove ${row.ticker}`}>
                            Remove
                          </button>
                        </td>
                      </tr>
                      {editing && (
                        <tr>
                          <td colSpan={5}>
                            <div style={{ padding: '8px 0' }}>
                              <LiveSettingsFields value={editSettings} onChange={setEditSettings} idPrefix={`edit-${row.ticker}-`} />

                              <div className="settings-group-hint" style={{ marginTop: 16, marginBottom: 4 }}>
                                Your position (leave all three blank to clear it):
                              </div>
                              <div className="settings-group">
                                <div className="settings-field">
                                  <label htmlFor={`edit-${row.ticker}-entryDate`}>Entry date</label>
                                  <input
                                    id={`edit-${row.ticker}-entryDate`} type="date"
                                    value={editEntryDate} onChange={(e) => setEditEntryDate(e.target.value)}
                                  />
                                </div>
                                <div className="settings-field">
                                  <label htmlFor={`edit-${row.ticker}-shares`}>Shares</label>
                                  <input
                                    id={`edit-${row.ticker}-shares`} type="number" min={0} step="any"
                                    value={editShares} onChange={(e) => setEditShares(e.target.value)}
                                  />
                                </div>
                                <div className="settings-field">
                                  <label htmlFor={`edit-${row.ticker}-entryPrice`}>Entry price ($)</label>
                                  <input
                                    id={`edit-${row.ticker}-entryPrice`} type="number" min={0} step="any"
                                    value={editEntryPrice} onChange={(e) => setEditEntryPrice(e.target.value)}
                                  />
                                </div>
                              </div>

                              <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                                <button type="button" className="analyze-btn" disabled={saving} onClick={() => saveEditor(row.ticker)}>
                                  {saving ? 'Saving...' : 'Save'}
                                </button>
                                <button type="button" className="settings-toggle" onClick={closeEditor}>
                                  Cancel
                                </button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
