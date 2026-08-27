'use client';

import { useState } from 'react';
import { DEFAULT_LIVE_SETTINGS, isDefault, type LiveSettings } from '@/lib/settings';
import { LiveSettingsFields } from './SettingsFields';

export function SettingsPanel({
  settings,
  onApply,
}: {
  settings: LiveSettings;
  onApply: (settings: LiveSettings) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<LiveSettings>(settings);
  const [confirming, setConfirming] = useState(false);

  function openPanel() {
    setPending(settings); // discard any stale edits from a prior open/cancel
    setOpen(true);
    setConfirming(false);
  }

  function requestApply() {
    setConfirming(true);
  }

  function confirmApply() {
    onApply(pending);
    setConfirming(false);
    setOpen(false);
  }

  function cancel() {
    setConfirming(false);
    setOpen(false);
  }

  function resetToDefaults() {
    setPending(DEFAULT_LIVE_SETTINGS);
    setConfirming(true);
  }

  return (
    <div className="settings-panel">
      <button type="button" className="settings-toggle" onClick={() => (open ? cancel() : openPanel())}>
        {open ? '▾' : '▸'} Indicator Settings
      </button>

      {open && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
            <div className="settings-group-hint">
              These affect the live report above and the baseline for Historical Testing below. Backtest-only
              execution filters live inside Historical Testing itself.
            </div>
            {!isDefault(settings) && (
              <span className="badge settings-badge-active" style={{ flexShrink: 0 }}>Custom settings active</span>
            )}
          </div>
          <LiveSettingsFields value={pending} onChange={setPending} />

          {confirming ? (
            <div className="settings-confirm">
              This will recompute the current report&apos;s Overall/Computed/AI signals using your new settings.
              Continue?
              <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                <button type="button" className="analyze-btn" onClick={confirmApply}>Confirm</button>
                <button type="button" className="settings-toggle" onClick={() => setConfirming(false)}>Cancel</button>
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
              <button type="button" className="analyze-btn" onClick={requestApply}>Apply</button>
              <button type="button" className="settings-toggle" onClick={resetToDefaults}>Reset to defaults</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
