'use client';

import { useState } from 'react';
import type { IndicatorSettings } from '@/lib/settings';
import { SettingsFields } from './SettingsFields';

/** Lets the user build one alternate settings profile to compare against the
 * current baseline, starting from the current settings rather than blank
 * defaults — this is "what if I changed X," not "start from scratch." */
export function ScenarioForm({
  initial,
  onRun,
  onCancel,
  running,
}: {
  initial: IndicatorSettings;
  onRun: (settings: IndicatorSettings) => void;
  onCancel: () => void;
  running: boolean;
}) {
  const [pending, setPending] = useState<IndicatorSettings>(initial);

  return (
    <div className="settings-panel" style={{ marginTop: 16 }}>
      <div className="settings-group-title">Scenario settings</div>
      <div className="settings-group-hint">Starting from your current settings — edit any lever, then run the comparison.</div>
      <SettingsFields value={pending} onChange={setPending} />
      <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
        <button type="button" className="analyze-btn" onClick={() => onRun(pending)} disabled={running}>
          {running ? 'Running…' : 'Run Comparison'}
        </button>
        <button type="button" className="settings-toggle" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
