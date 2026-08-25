'use client';

import { useEffect, useState } from 'react';
import { addTicker, fetchWatchlist, removeTicker } from '@/lib/watchlistApi';
import { sleep } from '@/lib/polling.ts';
import { SignalPill } from './SignalPill';
import type { WatchlistDashboardRow } from '@/types/watchlist';

const TICKER_PATTERN = /^[A-Z]{1,5}(\.[A-Z]{1,2})?$/;
// The server-side capture this triggers isn't job/poll-tracked (it's
// fire-and-forget), so this is a plain client-side poll rather than
// lib/polling.ts's pollUntilDone: a timeout here should just leave the row
// showing pending, not surface an error the way a real job timeout would.
const POLL_INTERVAL_MS = 5000;
const POLL_MAX_MS = 90 * 1000;

export function WatchlistDashboard({ accessToken }: { accessToken: string }) {
  const [rows, setRows] = useState<WatchlistDashboardRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newTicker, setNewTicker] = useState('');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchWatchlist(accessToken).then((res) => {
      if (cancelled) return;
      if (res.ok) setRows(res.rows);
      else setError(res.reason);
    });
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  async function pollUntilResolved(ticker: string) {
    const deadline = Date.now() + POLL_MAX_MS;
    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);
      const res = await fetchWatchlist(accessToken);
      if (!res.ok) return;
      setRows(res.rows);
      const row = res.rows.find((r) => r.ticker === ticker);
      if (row && !row.pending) return;
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const ticker = newTicker.trim().toUpperCase();
    if (!ticker || !TICKER_PATTERN.test(ticker)) return;

    setAdding(true);
    setError(null);
    const res = await addTicker(accessToken, ticker);
    setAdding(false);
    if (!res.ok) {
      setError(res.reason);
      return;
    }

    setNewTicker('');
    setRows((prev) => {
      const withoutDuplicate = (prev ?? []).filter((r) => r.ticker !== ticker);
      return [...withoutDuplicate, { ticker, overall: null, computed: null, ai: null, asOf: null, pending: true }];
    });
    void pollUntilResolved(ticker);
  }

  async function handleRemove(ticker: string) {
    setRows((prev) => (prev ?? []).filter((r) => r.ticker !== ticker));
    await removeTicker(accessToken, ticker);
  }

  function cell(signal: WatchlistDashboardRow['overall'], pending: boolean) {
    if (signal) return <SignalPill signal={signal} size="sm" />;
    return <span className="fact">{pending ? 'pending' : 'N/A'}</span>;
  }

  return (
    <div>
      <form onSubmit={handleAdd} style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
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

      {error && (
        <div className="error-card" style={{ marginBottom: 12 }}>
          <p>{error}</p>
        </div>
      )}

      {rows === null ? (
        <div className="settings-group-hint">Loading your watchlist...</div>
      ) : rows.length === 0 ? (
        <div className="settings-group-hint">Add a ticker above to start tracking it daily.</div>
      ) : (
        <table className="trade-list">
          <thead>
            <tr>
              <th>Ticker</th>
              <th>Overall</th>
              <th>Computed</th>
              <th>AI</th>
              <th>As of</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.ticker}>
                <td className="tabular" style={{ fontWeight: 700 }}>{row.ticker}</td>
                <td>{cell(row.overall, row.pending)}</td>
                <td>{cell(row.computed, row.pending)}</td>
                <td>{cell(row.ai, row.pending)}</td>
                <td className="fact">{row.asOf ?? 'N/A'}</td>
                <td>
                  <button type="button" className="settings-toggle" onClick={() => handleRemove(row.ticker)} aria-label={`Remove ${row.ticker}`}>
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
