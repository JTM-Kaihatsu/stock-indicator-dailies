import type { IndicatorKey } from '@stock-indicator-dailies/shared';
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

export function ReportCard({ report }: { report: DailyReport }) {
  const { ticker, verdict, deterministic, image, warnings, timings } = report;
  const detSignal = deterministic?.signal ?? null;
  const vlmSignal = verdict.signal;
  // Overall: computed always wins when available — it's the accurate signal
  // source, AI is a cross-check. Falls back to the AI read only when the
  // deterministic fetch itself failed (no computed signal to defer to).
  const overallSignal = detSignal ?? vlmSignal;
  const disagree = detSignal !== null && detSignal !== vlmSignal;

  const vlmByKey = new Map(verdict.readings.map((r) => [r.indicator, r]));
  const detByKey = new Map((deterministic?.readings ?? []).map((r) => [r.indicator, r]));

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
          />
        ))}
      </section>

      {(disagree || warnings.length > 0) && (
        <section style={{ marginTop: 16 }}>
          {disagree && (
            <div className="note note-warn">
              The computed and AI reads disagree — worth a look at the chart.
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
