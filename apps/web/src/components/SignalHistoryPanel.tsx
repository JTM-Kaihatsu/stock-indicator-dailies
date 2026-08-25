'use client';

import { useEffect, useState } from 'react';
import { fetchHistory } from '@/lib/historyApi';
import { SignalPill } from './SignalPill';
import type { SignalHistoryEntry } from '@/types/history';

const dateOnly = (iso: string) => iso.slice(0, 10);

/** Self-contained, like BacktestPanel: fetches its own data rather than
 * being fed via props, since it's a related-but-separate concern from the
 * report currently on screen. Shows a ticker's recent capture history
 * (independent of whether it's on anyone's watchlist), so you can see a
 * trend even for a one-off lookup. */
export function SignalHistoryPanel({ ticker }: { ticker: string }) {
  const [entries, setEntries] = useState<SignalHistoryEntry[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setEntries(null);
    fetchHistory(ticker).then((res) => {
      if (cancelled) return;
      setEntries(res.ok ? res.entries : []);
    });
    return () => {
      cancelled = true;
    };
  }, [ticker]);

  // Fewer than 2 entries: nothing about "change over time" to show yet.
  if (entries !== null && entries.length < 2) return null;

  return (
    <section className="backtest-panel" style={{ marginTop: 28 }}>
      <div className="section-label">Recent history</div>
      <div className="settings-group-hint">Past reads for {ticker}, most recent first.</div>

      {entries === null ? (
        <div className="settings-group-hint">Loading...</div>
      ) : (
        <table className="trade-list">
          <thead>
            <tr>
              <th>Date</th>
              <th>Overall</th>
              <th>Computed</th>
              <th>AI</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry, i) => (
              <tr key={i}>
                <td className="tabular">{dateOnly(entry.capturedAt)}</td>
                <td><SignalPill signal={entry.overall} size="sm" /></td>
                <td>{entry.computed ? <SignalPill signal={entry.computed} size="sm" /> : <span className="fact">N/A</span>}</td>
                <td><SignalPill signal={entry.ai} size="sm" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
