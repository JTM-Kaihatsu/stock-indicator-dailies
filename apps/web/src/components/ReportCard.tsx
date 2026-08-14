import type { DeriveSignalOptions, IndicatorKey, Signal } from '@stock-indicator-dailies/shared';
import { deriveIndicatorSignal } from '@stock-indicator-dailies/shared';
import type { DailyReport } from '@/types/api';
import { SignalPill } from './SignalPill';
import { IndicatorRow } from './IndicatorRow';
import { ChartImage } from './ChartImage';

const INDICATORS: IndicatorKey[] = ['macd', 'slowStochastic', 'sma'];

function sigClass(s: string): string {
  if (s === 'BUY') return 'sig-buy';
  if (s === 'SELL') return 'sig-sell';
  return 'sig-neutral';
}

/**
 * Resolve the overall recommendation from the computed and AI signals.
 * Asymmetric and risk-averse: either side calling SELL is enough to exit,
 * but BUY needs both to agree — computed alone calling HOLD keeps it at
 * HOLD even if the AI read is more bullish.
 */
function resolveOverall(detSignal: Signal | null, vlmSignal: Signal): Signal {
  if (detSignal === null) return vlmSignal; // no computed data to defer to
  if (detSignal === 'SELL' || vlmSignal === 'SELL') return 'SELL';
  if (detSignal === 'HOLD') return 'HOLD';
  if (detSignal === 'BUY' && vlmSignal === 'BUY') return 'BUY';
  return 'HOLD';
}

export function ReportCard({ report, options }: { report: DailyReport; options?: DeriveSignalOptions }) {
  const { ticker, verdict, deterministic, image, warnings, timings } = report;
  const detSignal = deterministic?.signal ?? null;
  const vlmSignal = verdict.signal;
  const overallSignal = resolveOverall(detSignal, vlmSignal);

  const vlmByKey = new Map(verdict.readings.map((r) => [r.indicator, r]));
  const detByKey = new Map((deterministic?.readings ?? []).map((r) => [r.indicator, r]));

  // The disagreement note tracks the per-indicator DIFFERS badges below, not
  // the overall signal — the two aren't the same thing once the overall
  // policy can resolve to a single value even when individual reads differ.
  // Uses the same `options` IndicatorRow renders with, so the note never
  // contradicts what the per-row badges show.
  const anyDiffers = INDICATORS.some((key) => {
    const det = detByKey.get(key);
    const vlm = vlmByKey.get(key);
    if (!det || !vlm) return false;
    return deriveIndicatorSignal(det, options) !== deriveIndicatorSignal(vlm, options);
  });

  return (
    <div>
      <header style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
        <div>
          <div className="eyebrow">Stock Indicator Dailies</div>
          <h1 style={{ fontFamily: 'var(--mono)', fontSize: 40, fontWeight: 600, letterSpacing: '-.01em', margin: '2px 0 0' }}>{ticker}</h1>
          <div className="tabular" style={{ color: 'var(--muted)', fontSize: 13 }}>
            daily bars · as of {deterministic?.asOf ?? '—'}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <span style={{ display: 'block', textTransform: 'uppercase', letterSpacing: '.1em', fontSize: 10, color: 'var(--faint)', marginBottom: 6 }}>
            Overall
          </span>
          <SignalPill signal={overallSignal} />
          <div style={{ marginTop: 10, display: 'flex', gap: 14, justifyContent: 'flex-end', fontSize: 12, color: 'var(--muted)' }}>
            <span>
              Computed:{' '}
              {detSignal ? (
                <b className={sigClass(detSignal)} style={{ fontFamily: 'var(--mono)' }}>{detSignal}</b>
              ) : (
                <b style={{ fontFamily: 'var(--mono)' }}>—</b>
              )}
            </span>
            <span>
              AI: <b className={sigClass(vlmSignal)} style={{ fontFamily: 'var(--mono)' }}>{vlmSignal}</b>
            </span>
          </div>
        </div>
      </header>

      <section style={{ marginTop: 28 }}>
        <div className="section-label">Indicators · computed vs AI · hover for detail</div>
        {INDICATORS.map((key) => (
          <IndicatorRow
            key={key}
            indicator={key}
            detReading={detByKey.get(key)}
            vlmReading={vlmByKey.get(key)}
            deterministic={deterministic}
            options={options}
          />
        ))}
      </section>

      {(anyDiffers || warnings.length > 0) && (
        <section style={{ marginTop: 16 }}>
          {anyDiffers && (
            <div className="note note-warn">
              The computed and AI results disagree. It's advised for you to look at the source chart below.
            </div>
          )}
          {warnings.map((w, i) => <div key={i} className="note">{w}</div>)}
        </section>
      )}

      <section style={{ marginTop: 28 }}>
        <ChartImage image={image} ticker={ticker} />
      </section>

      <footer>
        <div className="prov">
          <span className="badge">
            Computed · <b>{deterministic?.source ?? 'n/a'} OHLC</b>{deterministic ? ` · ${deterministic.bars} bars` : ''}
          </span>
          <span className="badge">AI read · <b>claude-sonnet-5</b></span>
          <span className="badge">Chart · <b>TradingView</b></span>
        </div>
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--faint)' }}>
          Pipeline: {(timings.totalMs / 1000).toFixed(1)}s
          (capture {(timings.captureMs / 1000).toFixed(1)}s
          · analyze {(timings.analyzeMs / 1000).toFixed(1)}s
          · data {(timings.deterministicMs / 1000).toFixed(1)}s)
        </div>
        <div style={{ marginTop: 8 }}>Not financial advice. A data-acquisition and reporting tool; every decision is yours to make.</div>
      </footer>
    </div>
  );
}
