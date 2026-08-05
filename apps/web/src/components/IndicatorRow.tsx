import type { IndicatorKey, IndicatorReading, IndicatorSignal } from '@stock-indicator-dailies/shared';
import { deriveIndicatorSignal } from '@stock-indicator-dailies/shared';
import type { DeterministicRead } from '@/types/api';

const INDICATOR_META: Record<IndicatorKey, { name: string; params: string }> = {
  macd: { name: 'MACD', params: '8, 17, 9' },
  slowStochastic: { name: 'Slow Stochastic', params: '14, 5, 3' },
  sma: { name: '10-day SMA', params: 'period 10' },
};

function factLabel(r: IndicatorReading): string {
  if (r.crossover === 'NONE') return 'no crossover';
  const dir = r.crossover === 'BULLISH' ? 'bullish' : 'bearish';
  const qual = r.qualified ? '' : ' · unqualified';
  return `${dir} · ${r.barsAgo}d ago${qual}`;
}

function sigClass(s: IndicatorSignal): string {
  if (s === 'BUY') return 'sig-buy';
  if (s === 'SELL') return 'sig-sell';
  return 'sig-neutral';
}

const num = (n: number, dp = 2) => Number.isFinite(n) ? n.toFixed(dp) : '—';

function computedTip(indicator: IndicatorKey, det: DeterministicRead | undefined): string {
  if (!det) return '';
  const v = det.values;
  if (indicator === 'macd')
    return `MACD ${num(v.macd.macd)} · signal ${num(v.macd.signal)} · hist ${num(v.macd.histogram)}`;
  if (indicator === 'slowStochastic')
    return `%K ${num(v.stochastic.percentK)} · %D ${num(v.stochastic.percentD)}`;
  return `SMA ${num(v.sma)} · close ${num(v.close)}`;
}

function ReadCell({ label, signal, fact, tip }: { label: string; signal: IndicatorSignal; fact: string; tip: string }) {
  return (
    <div className="read" tabIndex={0}>
      <span className="read-label">{label}</span>
      <span className={`sig ${sigClass(signal)}`}>{signal}</span>
      <span className="fact">{fact}</span>
      {tip && <span className="tip">{tip}</span>}
    </div>
  );
}

export function IndicatorRow({
  indicator,
  detReading,
  vlmReading,
  deterministic,
}: {
  indicator: IndicatorKey;
  detReading: IndicatorReading | undefined;
  vlmReading: IndicatorReading | undefined;
  deterministic: DeterministicRead | undefined;
}) {
  const meta = INDICATOR_META[indicator];
  const detSig = detReading ? deriveIndicatorSignal(detReading) : 'NEUTRAL' as IndicatorSignal;
  const vlmSig = vlmReading ? deriveIndicatorSignal(vlmReading) : 'NEUTRAL' as IndicatorSignal;
  const match = detReading && vlmReading ? detSig === vlmSig : false;
  const hasBoth = !!(detReading && vlmReading);

  return (
    <div className="ind-row">
      <div className="ind-name">
        <span className="ind-title">{meta.name}</span>
        <span className="ind-params">{meta.params}</span>
      </div>
      {detReading ? (
        <ReadCell label="Computed" signal={detSig} fact={factLabel(detReading)} tip={computedTip(indicator, deterministic)} />
      ) : (
        <div className="read-empty"><span className="read-label">Computed</span><span className="fact">unavailable</span></div>
      )}
      {vlmReading ? (
        <ReadCell label="AI read" signal={vlmSig} fact={factLabel(vlmReading)} tip={vlmReading.rationale ?? ''} />
      ) : (
        <div className="read-empty"><span className="read-label">AI read</span><span className="fact">&mdash;</span></div>
      )}
      <div className={`agree ${hasBoth ? (match ? 'agree-yes' : 'agree-no') : 'agree-na'}`}>
        {hasBoth ? (match ? 'match' : 'differs') : '—'}
      </div>
    </div>
  );
}
