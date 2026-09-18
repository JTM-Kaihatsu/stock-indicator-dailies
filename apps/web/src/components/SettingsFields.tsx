'use client';

import { riskToleranceLabel, type BacktestOnlySettings, type LiveSettings } from '@/lib/settings';

const num = (v: string, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export function InfoIcon({ text }: { text: string }) {
  return (
    <span className="info-icon" tabIndex={0}>
      i
      <span className="tip">{text}</span>
    </span>
  );
}

/** The 3 levers that drive the live report. Used by both the global
 * Indicator Settings panel and (with a distinct `idPrefix`, since both can
 * be open at once) Historical Testing's own local policy override. */
export function LiveSettingsFields({
  value,
  onChange,
  idPrefix = '',
}: {
  value: LiveSettings;
  onChange: (next: LiveSettings) => void;
  idPrefix?: string;
}) {
  /** Every field edited here also clears riskTolerance: it's no longer a
   * user-editable lever (see the read-only provenance line below), so the
   * only way it changes is via this side effect. The moment any field is
   * hand-edited, the settings no longer exactly match what AI proposed, so
   * the "AI analysis suggested..." claim must stop being true. */
  function set<K extends keyof LiveSettings>(key: K, v: LiveSettings[K]) {
    onChange({ ...value, [key]: v, riskTolerance: undefined });
  }

  return (
    <div className="settings-group">
      <div className="settings-field">
        <label htmlFor={`${idPrefix}buyConsensus`}>BUY needs at least (of 3)</label>
        <input
          id={`${idPrefix}buyConsensus`} type="number" min={1} max={3}
          value={value.buyConsensus}
          onChange={(e) => set('buyConsensus', num(e.target.value, value.buyConsensus))}
        />
      </div>
      <div className="settings-field">
        <label htmlFor={`${idPrefix}sellConsensus`}>SELL needs at least (of 3)</label>
        <input
          id={`${idPrefix}sellConsensus`} type="number" min={1} max={3}
          value={value.sellConsensus}
          onChange={(e) => set('sellConsensus', num(e.target.value, value.sellConsensus))}
        />
      </div>
      <div className="settings-field">
        <label htmlFor={`${idPrefix}recencyDays`}>Recency window (days)</label>
        <input
          id={`${idPrefix}recencyDays`} type="number" min={1} max={60}
          value={value.recencyDays}
          onChange={(e) => set('recencyDays', num(e.target.value, value.recencyDays))}
        />
      </div>
      <div className="settings-field">
        <span style={{ display: 'inline-flex', alignItems: 'center' }}>
          <label htmlFor={`${idPrefix}atrEnabled`}>Enable ATR noise reduction</label>
          <InfoIcon text="Plain English: Tracks if the stock has fallen below the peak price for a period enough to warrant selling it. Once set, also defines this ticker's live position-risk sell point (see Manage Watchlist)." />
        </span>
        <input
          id={`${idPrefix}atrEnabled`} type="checkbox"
          checked={value.atrMultiplier !== undefined}
          onChange={(e) => set('atrMultiplier', e.target.checked ? 2 : undefined)}
        />
      </div>
      {value.atrMultiplier !== undefined && (
        <>
          <div className="settings-field settings-subfield">
            <label htmlFor={`${idPrefix}atrMultiplier`}>ATR multiplier</label>
            <input
              id={`${idPrefix}atrMultiplier`} type="number" min={0} max={20} step={0.5}
              value={value.atrMultiplier}
              onChange={(e) => set('atrMultiplier', num(e.target.value, value.atrMultiplier ?? 2))}
            />
          </div>
          <div className="settings-field settings-subfield">
            <label htmlFor={`${idPrefix}atrPeriod`}>ATR period</label>
            <input
              id={`${idPrefix}atrPeriod`} type="number" min={2} max={100}
              value={value.atrPeriod}
              onChange={(e) => set('atrPeriod', num(e.target.value, value.atrPeriod))}
            />
          </div>
        </>
      )}
      <div className="settings-field">
        <span style={{ display: 'inline-flex', alignItems: 'center' }}>
          <label htmlFor={`${idPrefix}adxEnabled`}>Enable ADX trend-strength gate</label>
          <InfoIcon text="Plain English: Measures trend by seeing how steep the slope is." />
        </span>
        <input
          id={`${idPrefix}adxEnabled`} type="checkbox"
          checked={value.adxThreshold !== undefined}
          onChange={(e) => set('adxThreshold', e.target.checked ? 25 : undefined)}
        />
      </div>
      {value.adxThreshold !== undefined && (
        <>
          <div className="settings-field settings-subfield">
            <label htmlFor={`${idPrefix}adxThreshold`}>ADX threshold</label>
            <input
              id={`${idPrefix}adxThreshold`} type="number" min={0} max={100}
              value={value.adxThreshold}
              onChange={(e) => set('adxThreshold', num(e.target.value, value.adxThreshold ?? 25))}
            />
          </div>
          <div className="settings-field settings-subfield">
            <label htmlFor={`${idPrefix}adxPeriod`}>ADX period</label>
            <input
              id={`${idPrefix}adxPeriod`} type="number" min={2} max={100}
              value={value.adxPeriod}
              onChange={(e) => set('adxPeriod', num(e.target.value, value.adxPeriod))}
            />
          </div>
        </>
      )}
      <div className="settings-group-hint" style={{ marginTop: 4 }}>
        {value.riskTolerance
          ? `AI analysis suggested the current settings under the risk-tolerance: ${riskToleranceLabel(value.riskTolerance)}`
          : 'AI analysis was not used for the current settings'}
      </div>
    </div>
  );
}

/** The 2 execution-filter levers that only affect Historical Testing. Used
 * inline inside BacktestPanel; never global. */
export function BacktestOnlySettingsFields({
  value,
  onChange,
}: {
  value: BacktestOnlySettings;
  onChange: (next: BacktestOnlySettings) => void;
}) {
  function set<K extends keyof BacktestOnlySettings>(key: K, v: BacktestOnlySettings[K]) {
    onChange({ ...value, [key]: v });
  }

  return (
    <div className="settings-group">
      <div className="settings-field">
        <label htmlFor="persistenceBars">Persistence (bars signal must repeat)</label>
        <input
          id="persistenceBars" type="number" min={1} max={30}
          value={value.persistenceBars}
          onChange={(e) => set('persistenceBars', num(e.target.value, value.persistenceBars))}
        />
      </div>
      <div className="settings-field">
        <label htmlFor="minHoldingDays">Minimum holding period (days)</label>
        <input
          id="minHoldingDays" type="number" min={0} max={365}
          value={value.minHoldingDays}
          onChange={(e) => set('minHoldingDays', num(e.target.value, value.minHoldingDays))}
        />
      </div>
    </div>
  );
}
