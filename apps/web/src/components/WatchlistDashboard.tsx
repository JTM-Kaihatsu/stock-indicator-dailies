'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { fetchWatchlist } from '@/lib/watchlistApi';
import { SignalPill } from './SignalPill';
import type { WatchlistDashboardRow } from '@/types/watchlist';

/**
 * Read-only overview: adding, removing, and per-stock sensitivity settings
 * all live on the dedicated /watchlist management page now, reachable from
 * the account pill's popover. This table just shows the current state and
 * links each ticker to its own result page.
 */
export function WatchlistDashboard({ accessToken }: { accessToken: string }) {
  const [rows, setRows] = useState<WatchlistDashboardRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  function cell(signal: WatchlistDashboardRow['overall'], pending: boolean) {
    if (signal) return <SignalPill signal={signal} size="sm" />;
    return <span className="fact">{pending ? 'pending' : 'N/A'}</span>;
  }

  function lastChanged(row: WatchlistDashboardRow) {
    if (!row.lastChangedAt) return <span className="fact">N/A</span>;
    return <span className="fact">{row.lastChangedAt.slice(0, 10)}</span>;
  }

  return (
    <div>
      <div className="section-label">Watchlist</div>

      {error && (
        <div className="error-card" style={{ marginBottom: 12 }}>
          <p>{error}</p>
        </div>
      )}

      {rows === null ? (
        <div className="settings-group-hint">Loading your watchlist...</div>
      ) : rows.length === 0 ? (
        <div className="settings-group-hint">
          No tickers yet. <Link href="/watchlist" className="auth-popover-link" style={{ display: 'inline', marginTop: 0 }}>Manage Watchlist →</Link>
        </div>
      ) : (
        <table className="trade-list">
          <thead>
            <tr>
              <th>Ticker</th>
              <th>Overall</th>
              <th>Computed</th>
              <th>AI</th>
              <th>As of</th>
              <th>Last changed</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.ticker}>
                <td className="tabular" style={{ fontWeight: 700 }}>
                  <Link href={`/watchlist/${row.ticker}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                    {row.ticker}
                  </Link>
                </td>
                <td>{cell(row.overall, row.pending)}</td>
                <td>{cell(row.computed, row.pending)}</td>
                <td>{cell(row.ai, row.pending)}</td>
                <td className="fact">{row.asOf ?? 'N/A'}</td>
                <td>{lastChanged(row)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
