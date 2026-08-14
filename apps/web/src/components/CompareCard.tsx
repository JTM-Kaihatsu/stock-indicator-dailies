import type { BacktestResult } from '@/types/backtest';
import { diffSettings, type IndicatorSettings } from '@/lib/settings';

const pct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
const money = (n: number) => `$${n.toFixed(2)}`;

function DeltaRow({ label, from, to, format, deltaFormat, higherIsBetter = true }: {
  label: string; from: number; to: number; format: (n: number) => string;
  deltaFormat: (n: number) => string; higherIsBetter?: boolean;
}) {
  const improved = higherIsBetter ? to > from : to < from;
  const worsened = higherIsBetter ? to < from : to > from;
  const deltaClass = improved ? 'pos' : worsened ? 'neg' : '';
  return (
    <div className="compare-row">
      <span className="compare-label">{label}</span>
      <span className="compare-values">
        {format(from)} <span className="compare-arrow">→</span> {format(to)}
        {to !== from && <span className={`compare-delta ${deltaClass}`}>{deltaFormat(to - from)}</span>}
      </span>
    </div>
  );
}

const pctDelta = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)} pts`;
const moneyDelta = (n: number) => `${n >= 0 ? '+' : '-'}$${Math.abs(n).toFixed(2)}`;

export function CompareCard({
  baselineSettings,
  scenarioSettings,
  baseline,
  scenario,
}: {
  baselineSettings: IndicatorSettings;
  scenarioSettings: IndicatorSettings;
  baseline: BacktestResult;
  scenario: BacktestResult;
}) {
  const changedFields = diffSettings(baselineSettings, scenarioSettings);

  return (
    <div className="compare-card">
      <div className="settings-group-title">Baseline vs scenario</div>
      {changedFields.length > 0 && (
        <div className="settings-group-hint">
          Changed: {changedFields.map((f) => `${f.label} (${f.from ?? 'off'} → ${f.to ?? 'off'})`).join(', ')}
        </div>
      )}
      <DeltaRow label="Strategy return" from={baseline.strategyReturnPct} to={scenario.strategyReturnPct} format={pct} deltaFormat={pctDelta} />
      <DeltaRow label="Final value" from={baseline.finalValue} to={scenario.finalValue} format={money} deltaFormat={moneyDelta} />
      <div className="compare-row">
        <span className="compare-label">Buy &amp; hold (reference)</span>
        <span className="compare-values">{pct(baseline.buyAndHoldReturnPct)}</span>
      </div>
    </div>
  );
}
