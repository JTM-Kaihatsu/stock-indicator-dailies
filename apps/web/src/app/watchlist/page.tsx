'use client';

import { Fragment, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/hooks/useAuth';
import { addTicker, fetchWatchlist, removeTicker, reorderWatchlist, updateWatchlistSettings } from '@/lib/watchlistApi';
import { DEFAULT_LIVE_SETTINGS, isDefault, type LiveSettings } from '@/lib/settings';
import { LiveSettingsFields } from '@/components/SettingsFields';
import type { WatchlistDashboardRow } from '@/types/watchlist';

const TICKER_PATTERN = /^[A-Z]{1,5}(\.[A-Z]{1,2})?$/;

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
  const [saving, setSaving] = useState(false);

  const [dragTicker, setDragTicker] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    fetchWatchlist(session.access_token).then((res) => {
      if (res.ok) setRows(res.rows);
      else setError(res.reason);
    });
  }, [session]);

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
        { ticker, overall: null, computed: null, ai: null, asOf: null, status: 'running', lastChangedAt: null, settings: settingsToSend ?? null },
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

  async function saveEditor(ticker: string) {
    if (!session) return;
    setSaving(true);
    const res = await updateWatchlistSettings(session.access_token, ticker, editSettings);
    setSaving(false);
    if (!res.ok) {
      setError(res.reason);
      return;
    }
    setRows((prev) => (prev ?? []).map((r) => (r.ticker === ticker ? { ...r, settings: editSettings } : r)));
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

      <div className="settings-panel">
        <div className="section-label">Manage Watchlist</div>

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
