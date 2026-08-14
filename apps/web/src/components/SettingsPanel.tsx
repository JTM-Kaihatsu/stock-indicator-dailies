'use client';

import { useState } from 'react';
import { DEFAULT_SETTINGS, isDefault, type IndicatorSettings } from '@/lib/settings';
import { SettingsFields } from './SettingsFields';

export function SettingsPanel({
  settings,
  onApply,
}: {
  settings: IndicatorSettings;
  onApply: (settings: IndicatorSettings) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<IndicatorSettings>(settings);
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
    setPending(DEFAULT_SETTINGS);
    setConfirming(true);
  }

  return (
    <div className="settings-panel">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <button type="button" className="settings-toggle" onClick={() => (open ? cancel() : openPanel())}>
          {open ? '▾' : '▸'} Indicator Settings
        </button>
        {!isDefault(settings) && <span className="badge settings-badge-active">custom settings active</span>}
      </div>

      {open && (
        <div style={{ marginTop: 12 }}>
          <SettingsFields value={pending} onChange={setPending} />

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
              <button type="button" className="settings-toggle" onClick={cancel}>Close</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
