'use client';

import type { IndicatorSettings } from '@/lib/settings';

/** Pure controlled form for the 9 levers, grouped by where they actually take
 * effect. Reused by both SettingsPanel (Phase 1) and ScenarioForm (Phase 3). */
export function SettingsFields({
  value,
  onChange,
}: {
  value: IndicatorSettings;
  onChange: (next: IndicatorSettings) => void;
}) {
  function set<K extends keyof IndicatorSettings>(key: K, v: IndicatorSettings[K]) {
    onChange({ ...value, [key]: v });
  }

  const num = (v: string, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };

  return (
    <div>
      <div className="settings-group">
        <div className="settings-group-title">Live signal &amp; backtest baseline</div>
        <div className="settings-group-hint">
          These affect both the live report above and the baseline for Historical Testing below.
        </div>
        <div className="settings-field">
          <label htmlFor="buyConsensus">BUY needs at least (of 3)</label>
          <input
            id="buyConsensus" type="number" min={1} max={3}
            value={value.buyConsensus}
            onChange={(e) => set('buyConsensus', num(e.target.value, value.buyConsensus))}
          />
        </div>
        <div className="settings-field">
          <label htmlFor="sellConsensus">SELL needs at least (of 3)</label>
          <input
            id="sellConsensus" type="number" min={1} max={3}
            value={value.sellConsensus}
            onChange={(e) => set('sellConsensus', num(e.target.value, value.sellConsensus))}
          />
        </div>
        <div className="settings-field">
          <label htmlFor="recencyDays">Recency window (days)</label>
          <input
            id="recencyDays" type="number" min={1} max={60}
            value={value.recencyDays}
            onChange={(e) => set('recencyDays', num(e.target.value, value.recencyDays))}
          />
        </div>
      </div>

      <div className="settings-group">
        <div className="settings-group-title">Backtest-only execution filters</div>
        <div className="settings-group-hint">
          These only affect Historical Testing below — they have no effect on the live report, which is a
          single-day snapshot with no concept of an open position.
        </div>
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
        <div className="settings-field">
          <label htmlFor="atrEnabled">Enable ATR noise reduction</label>
          <input
            id="atrEnabled" type="checkbox"
            checked={value.atrMultiplier !== undefined}
            onChange={(e) => set('atrMultiplier', e.target.checked ? 2 : undefined)}
          />
        </div>
        {value.atrMultiplier !== undefined && (
          <>
            <div className="settings-field settings-subfield">
              <label htmlFor="atrMultiplier">ATR multiplier</label>
              <input
                id="atrMultiplier" type="number" min={0} max={20} step={0.5}
                value={value.atrMultiplier}
                onChange={(e) => set('atrMultiplier', num(e.target.value, value.atrMultiplier ?? 2))}
              />
            </div>
            <div className="settings-field settings-subfield">
              <label htmlFor="atrPeriod">ATR period</label>
              <input
                id="atrPeriod" type="number" min={2} max={100}
                value={value.atrPeriod}
                onChange={(e) => set('atrPeriod', num(e.target.value, value.atrPeriod))}
              />
            </div>
          </>
        )}
        <div className="settings-field">
          <label htmlFor="adxEnabled">Enable ADX trend-strength gate</label>
          <input
            id="adxEnabled" type="checkbox"
            checked={value.adxThreshold !== undefined}
            onChange={(e) => set('adxThreshold', e.target.checked ? 25 : undefined)}
          />
        </div>
        {value.adxThreshold !== undefined && (
          <>
            <div className="settings-field settings-subfield">
              <label htmlFor="adxThreshold">ADX threshold</label>
              <input
                id="adxThreshold" type="number" min={0} max={100}
                value={value.adxThreshold}
                onChange={(e) => set('adxThreshold', num(e.target.value, value.adxThreshold ?? 25))}
              />
            </div>
            <div className="settings-field settings-subfield">
              <label htmlFor="adxPeriod">ADX period</label>
              <input
                id="adxPeriod" type="number" min={2} max={100}
                value={value.adxPeriod}
                onChange={(e) => set('adxPeriod', num(e.target.value, value.adxPeriod))}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
