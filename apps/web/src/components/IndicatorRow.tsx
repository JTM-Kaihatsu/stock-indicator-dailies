import type { DeriveSignalOptions, IndicatorKey, IndicatorReading, IndicatorSignal } from '@stock-indicator-dailies/shared';
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

const num = (n: number, dp = 2) => Number.isFinite(n) ? n.toFixed(dp) : 'N/A';

function valuesLine(indicator: IndicatorKey, v: DeterministicRead['values']): string {
  if (indicator === 'macd') return `MACD ${num(v.macd.macd)} · signal ${num(v.macd.signal)} · hist ${num(v.macd.histogram)}`;
  if (indicator === 'slowStochastic') return `%K ${num(v.stochastic.percentK)} · %D ${num(v.stochastic.percentD)}`;
  return `SMA ${num(v.sma)} · close ${num(v.close)}`;
}

/** One-sentence explanation of the deterministic read, in the same style as
 * the AI's own rationale; built from the crossover facts rather than
 * narrated, since there's no chart context to describe. */
function computedRationale(indicator: IndicatorKey, reading: IndicatorReading, v: DeterministicRead['values']): string {
  const bullish = reading.crossover === 'BULLISH';
  const ago = reading.barsAgo;

  if (reading.crossover === 'NONE') {
    if (indicator === 'macd') return `No MACD/signal crossover in view; currently ${num(v.macd.macd)} vs ${num(v.macd.signal)}.`;
    if (indicator === 'slowStochastic') return `No %K/%D crossover in view; currently ${num(v.stochastic.percentK)} vs ${num(v.stochastic.percentD)}.`;
    return `Price hasn't crossed the SMA recently; currently ${num(v.close)} vs ${num(v.sma)}.`;
  }

  if (indicator === 'macd') {
    const zone = reading.qualified ? (bullish ? 'below zero' : 'above zero') : (bullish ? 'already above zero' : 'already below zero');
    const verdict = reading.qualified ? 'a fresh reversal' : "doesn't qualify as a fresh reversal";
    return `MACD crossed ${bullish ? 'above' : 'below'} signal ${ago}d ago while ${zone}, ${verdict}; now ${num(v.macd.macd)} vs ${num(v.macd.signal)}.`;
  }
  if (indicator === 'slowStochastic') {
    const zone = bullish ? 'oversold (<20)' : 'overbought (>80)';
    const verdict = reading.qualified ? `from ${zone}, a ${bullish ? 'buy' : 'sell'} setup` : `but not from ${zone}, so it doesn't qualify`;
    return `%K crossed ${bullish ? 'above' : 'below'} %D ${ago}d ago ${verdict}; now ${num(v.stochastic.percentK)} vs ${num(v.stochastic.percentD)}.`;
  }
  const slope = bullish ? 'rising' : 'falling';
  const verdict = reading.qualified ? `a ${bullish ? 'bullish' : 'bearish'} setup` : `but the SMA isn't ${slope}, so it doesn't qualify`;
  return `Price crossed ${bullish ? 'above' : 'below'} the SMA ${ago}d ago, ${verdict}; now ${num(v.close)} vs ${num(v.sma)}.`;
}

function computedTip(indicator: IndicatorKey, reading: IndicatorReading | undefined, det: DeterministicRead | undefined): string {
  if (!det || !reading) return '';
  return `${computedRationale(indicator, reading, det.values)}\n${valuesLine(indicator, det.values)}`;
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
  options,
}: {
  indicator: IndicatorKey;
  detReading: IndicatorReading | undefined;
  vlmReading: IndicatorReading | undefined;
  deterministic: DeterministicRead | undefined;
  options?: DeriveSignalOptions;
}) {
  const meta = INDICATOR_META[indicator];
  const detSig = detReading ? deriveIndicatorSignal(detReading, options) : 'NEUTRAL' as IndicatorSignal;
  const vlmSig = vlmReading ? deriveIndicatorSignal(vlmReading, options) : 'NEUTRAL' as IndicatorSignal;
  const match = detReading && vlmReading ? detSig === vlmSig : false;
  const hasBoth = !!(detReading && vlmReading);

  return (
    <div className="ind-row">
      <div className="ind-name">
        <span className="ind-title">{meta.name}</span>
        <span className="ind-params">{meta.params}</span>
      </div>
      {detReading ? (
        <ReadCell label="Computed" signal={detSig} fact={factLabel(detReading)} tip={computedTip(indicator, detReading, deterministic)} />
      ) : (
        <div className="read-empty"><span className="read-label">Computed</span><span className="fact">unavailable</span></div>
      )}
      {vlmReading ? (
        <ReadCell label="AI read" signal={vlmSig} fact={factLabel(vlmReading)} tip={vlmReading.rationale ?? ''} />
      ) : (
        <div className="read-empty"><span className="read-label">AI read</span><span className="fact">N/A</span></div>
      )}
      <div className={`agree ${hasBoth ? (match ? 'agree-yes' : 'agree-no') : 'agree-na'}`}>
        {hasBoth ? (match ? 'match' : 'differs') : 'N/A'}
      </div>
    </div>
  );
}
