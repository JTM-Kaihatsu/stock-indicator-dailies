'use client';

import { useState } from 'react';
import type { PositionRisk, UnrealizedPnl, WatchlistPosition } from '@/types/watchlist';

const pct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
const usd = (n: number) => `$${n.toFixed(2)}`;

/** A watchlisted ticker's own real position: record when it was bought, how
 * many shares, and at what price, and see unrealized gains/losses plus
 * (once ATR noise reduction is enabled in Indicator Settings) the live
 * sell-point this ticker's Overall signal is being watched against. */
export function PositionPanel({
  position,
  positionRisk,
  unrealizedPnl,
  onSave,
}: {
  position: WatchlistPosition | null;
  positionRisk: PositionRisk | null;
  unrealizedPnl: UnrealizedPnl | null;
  onSave: (position: WatchlistPosition | null) => Promise<{ ok: boolean; reason?: string }>;
}) {
  const [editing, setEditing] = useState(false);
  const [entryDate, setEntryDate] = useState(position?.entryDate ?? '');
  const [shares, setShares] = useState(position?.shares?.toString() ?? '');
  const [entryPrice, setEntryPrice] = useState(position?.entryPrice?.toString() ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openEditor() {
    setEntryDate(position?.entryDate ?? '');
    setShares(position?.shares?.toString() ?? '');
    setEntryPrice(position?.entryPrice?.toString() ?? '');
    setError(null);
    setEditing(true);
  }

  async function save() {
    const sharesNum = Number(shares);
    const priceNum = Number(entryPrice);
    if (!entryDate || !Number.isFinite(sharesNum) || sharesNum <= 0 || !Number.isFinite(priceNum) || priceNum <= 0) {
      setError('Enter a valid date, a positive share count, and a positive entry price.');
      return;
    }
    setSaving(true);
    setError(null);
    const result = await onSave({ entryDate, shares: sharesNum, entryPrice: priceNum });
    setSaving(false);
    if (!result.ok) {
      setError(result.reason ?? 'Could not save this position.');
      return;
    }
    setEditing(false);
  }

  async function clear() {
    setSaving(true);
    setError(null);
    const result = await onSave(null);
    setSaving(false);
    if (!result.ok) {
      setError(result.reason ?? 'Could not clear this position.');
      return;
    }
    setEditing(false);
  }

  return (
    <section className="settings-panel" style={{ marginTop: 20 }}>
      <div className="section-label">Your position</div>

      {!editing && !position && (
        <div className="settings-group-hint" style={{ marginBottom: 12 }}>
          Record when you bought this stock, how many shares, and at what price to track unrealized gains/losses
          and, once ATR noise reduction is enabled in Indicator Settings, a live sell-point alert.
        </div>
      )}

      {!editing && position && (
        <div style={{ marginBottom: 12 }}>
          <div className="settings-group-hint" style={{ marginBottom: 8 }}>
            {position.shares} shares at {usd(position.entryPrice)}, entered {position.entryDate}
          </div>
          {unrealizedPnl && (
            <div className="backtest-stats" style={{ marginBottom: 8 }}>
              <div className="backtest-stat">
                <div className="backtest-stat-label">Unrealized gain/loss</div>
                <div className={`backtest-stat-value ${unrealizedPnl.amount >= 0 ? 'pos' : 'neg'}`}>
                  {unrealizedPnl.amount >= 0 ? '+' : ''}
                  {usd(unrealizedPnl.amount)} ({pct(unrealizedPnl.pct)})
                </div>
              </div>
            </div>
          )}
          {positionRisk ? (
            <div
              style={{
                padding: '8px 12px',
                borderRadius: 8,
                fontSize: 13,
                background: positionRisk.triggered ? 'var(--sell-bg)' : 'var(--buy-bg)',
                color: positionRisk.triggered ? 'var(--sell)' : 'var(--buy)',
                border: `1px solid ${positionRisk.triggered ? 'var(--sell)' : 'var(--buy)'}`,
              }}
            >
              <b>{positionRisk.triggered ? 'Sell point breached' : 'Above sell point'}</b>
              <div style={{ marginTop: 4, fontWeight: 400 }}>
                Peak {usd(positionRisk.peakSinceEntry)} since entry minus {positionRisk.atrMultiplier}x the{' '}
                {positionRisk.atrPeriod}-day ATR ({usd(positionRisk.atrValue)}) = sell point at{' '}
                {usd(positionRisk.stopLevel)}. Current price: {usd(positionRisk.currentPrice)}.
              </div>
            </div>
          ) : (
            <div className="settings-group-hint">
              Enable ATR noise reduction in Indicator Settings to also track a live sell point for this position.
            </div>
          )}
        </div>
      )}

      {editing ? (
        <div className="settings-group">
          <div className="settings-field">
            <label htmlFor="posEntryDate">Entry date</label>
            <input id="posEntryDate" type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
          </div>
          <div className="settings-field">
            <label htmlFor="posShares">Shares</label>
            <input id="posShares" type="number" min={0} step="any" value={shares} onChange={(e) => setShares(e.target.value)} />
          </div>
          <div className="settings-field">
            <label htmlFor="posEntryPrice">Entry price ($)</label>
            <input id="posEntryPrice" type="number" min={0} step="any" value={entryPrice} onChange={(e) => setEntryPrice(e.target.value)} />
          </div>
          {error && (
            <div className="error-card" style={{ marginTop: 4 }}>
              <p>{error}</p>
            </div>
          )}
          <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
            <button type="button" className="analyze-btn" disabled={saving} onClick={save}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button type="button" className="settings-toggle" onClick={() => setEditing(false)}>
              Cancel
            </button>
            {position && (
              <button type="button" className="settings-toggle" disabled={saving} onClick={clear}>
                Clear position
              </button>
            )}
          </div>
        </div>
      ) : (
        <button type="button" className="settings-toggle" onClick={openEditor}>
          {position ? 'Edit position' : 'Record a position'}
        </button>
      )}
    </section>
  );
}
