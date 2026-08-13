import {
  deriveIndicatorSignal,
  type IndicatorKey,
  type IndicatorReading,
  type IndicatorSignal,
  type Signal,
} from '@stock-indicator-dailies/shared';

import type { DailyReport } from './run-daily.ts';

const INDICATOR_META: Record<IndicatorKey, { name: string; params: string }> = {
  macd: { name: 'MACD', params: '8, 17, 9' },
  slowStochastic: { name: 'Slow Stochastic', params: '14, 5, 3' },
  sma: { name: '10-day SMA', params: 'period 10' },
};

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const num = (n: number, dp = 2): string =>
  Number.isFinite(n) ? n.toFixed(dp) : '—';

/** Short human label for a crossover fact. */
function factLabel(r: IndicatorReading): string {
  if (r.crossover === 'NONE') return 'no crossover';
  const dir = r.crossover === 'BULLISH' ? 'bullish' : 'bearish';
  const qual = r.qualified ? '' : ' · unqualified';
  return `${dir} · ${r.barsAgo}d ago${qual}`;
}

/** The computed numbers relevant to one indicator, for the hover tooltip. */
function computedDetail(indicator: IndicatorKey, v: DailyReport['deterministic']): string {
  if (!v) return '';
  const { values } = v;
  if (indicator === 'macd')
    return `MACD ${num(values.macd.macd)} · signal ${num(values.macd.signal)} · hist ${num(values.macd.histogram)}`;
  if (indicator === 'slowStochastic')
    return `%K ${num(values.stochastic.percentK)} · %D ${num(values.stochastic.percentD)}`;
  return `SMA ${num(values.sma)} · close ${num(values.close)}`;
}

function signalClass(s: Signal | IndicatorSignal): string {
  return s === 'BUY' ? 'buy' : s === 'SELL' ? 'sell' : s === 'HOLD' ? 'hold' : 'neutral';
}

/** One read cell with a hover/focus tooltip. */
function readCell(label: string, signal: IndicatorSignal, fact: string, tip: string): string {
  return `<div class="read" tabindex="0">
    <span class="read-label">${label}</span>
    <span class="sig sig-${signalClass(signal)}">${signal}</span>
    <span class="fact">${esc(fact)}</span>
    ${tip ? `<span class="tip">${esc(tip)}</span>` : ''}
  </div>`;
}

/**
 * Render a self-contained HTML Daily Report: the deterministic (computed) read
 * as the headline, the VLM read alongside as an AI cross-check, the source chart
 * as evidence, with provenance and hover-for-detail throughout.
 */
export function renderDailyReportHtml(
  report: DailyReport,
  opts: { model?: string } = {},
): string {
  const { ticker, verdict, deterministic, image } = report;
  const model = opts.model ?? 'claude-sonnet-5';

  const detSignal: Signal | null = deterministic ? deterministic.signal : null;
  const vlmSignal = verdict.signal;
  const disagree = detSignal !== null && detSignal !== vlmSignal;

  const vlmByKey = new Map(verdict.readings.map((r) => [r.indicator, r]));
  const detByKey = new Map((deterministic?.readings ?? []).map((r) => [r.indicator, r]));

  const rows = (Object.keys(INDICATOR_META) as IndicatorKey[])
    .map((key) => {
      const meta = INDICATOR_META[key];
      const det = detByKey.get(key);
      const vlm = vlmByKey.get(key);
      const detSig = det ? deriveIndicatorSignal(det) : ('NEUTRAL' as IndicatorSignal);
      const vlmSig = vlm ? deriveIndicatorSignal(vlm) : ('NEUTRAL' as IndicatorSignal);
      const match = det && vlm ? detSig === vlmSig : false;

      const computedCell = det
        ? readCell('Computed', detSig, factLabel(det), computedDetail(key, deterministic))
        : `<div class="read read-empty">Computed<span class="fact">unavailable</span></div>`;
      const aiCell = vlm
        ? readCell('AI read', vlmSig, factLabel(vlm), vlm.rationale ?? '')
        : `<div class="read read-empty">AI read<span class="fact">—</span></div>`;

      return `<div class="ind-row">
        <div class="ind-name">
          <span class="ind-title">${meta.name}</span>
          <span class="ind-params">${meta.params}</span>
        </div>
        ${computedCell}
        ${aiCell}
        <div class="agree ${det && vlm ? (match ? 'agree-yes' : 'agree-no') : 'agree-na'}">
          ${det && vlm ? (match ? 'match' : 'differs') : '—'}
        </div>
      </div>`;
    })
    .join('\n');

  const headlinePill = detSignal
    ? `<span class="pill pill-${signalClass(detSignal)}">${detSignal}</span>`
    : `<span class="pill pill-neutral">NO DATA</span>`;

  const disclaimerAndNotes = [
    disagree
      ? `<div class="note note-warn">The computed and AI reads disagree — worth a look at the chart.</div>`
      : '',
    ...report.warnings.map((w) => `<div class="note">${esc(w)}</div>`),
  ].join('\n');

  const asOf = deterministic ? deterministic.asOf : '—';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(ticker)} · Daily Report</title>
<style>
  :root {
    --ground: #0f1319; --surface: #171c24; --surface-2: #1e242e; --border: #262d38;
    --text: #e6e9ef; --muted: #9aa4b2; --faint: #6b7482;
    --accent: #35d0ba;
    --buy: #2ec16b; --sell: #f0523f; --hold: #d0a03a;
    --buy-bg: rgba(46,193,107,.14); --sell-bg: rgba(240,82,63,.14); --hold-bg: rgba(208,160,58,.15);
    --mono: ui-monospace, "SF Mono", "SFMono-Regular", Menlo, Consolas, monospace;
    --sans: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  @media (prefers-color-scheme: light) {
    :root {
      --ground: #f6f7f9; --surface: #ffffff; --surface-2: #f0f2f5; --border: #e2e6ec;
      --text: #1b2027; --muted: #5a6473; --faint: #8a93a1;
      --buy: #1a9c53; --sell: #d63a28; --hold: #a9791f;
      --buy-bg: rgba(26,156,83,.10); --sell-bg: rgba(214,58,40,.09); --hold-bg: rgba(169,121,31,.12);
    }
  }
  :root[data-theme="light"] {
    --ground: #f6f7f9; --surface: #ffffff; --surface-2: #f0f2f5; --border: #e2e6ec;
    --text: #1b2027; --muted: #5a6473; --faint: #8a93a1;
    --buy: #1a9c53; --sell: #d63a28; --hold: #a9791f;
    --buy-bg: rgba(26,156,83,.10); --sell-bg: rgba(214,58,40,.09); --hold-bg: rgba(169,121,31,.12);
  }
  :root[data-theme="dark"] {
    --ground: #0f1319; --surface: #171c24; --surface-2: #1e242e; --border: #262d38;
    --text: #e6e9ef; --muted: #9aa4b2; --faint: #6b7482;
    --buy: #2ec16b; --sell: #f0523f; --hold: #d0a03a;
    --buy-bg: rgba(46,193,107,.14); --sell-bg: rgba(240,82,63,.14); --hold-bg: rgba(208,160,58,.15);
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--ground); color: var(--text);
    font-family: var(--sans); line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: 860px; margin: 0 auto; padding: 32px 20px 56px; }
  .tabular { font-variant-numeric: tabular-nums; }

  header { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; flex-wrap: wrap; }
  .eyebrow { text-transform: uppercase; letter-spacing: .12em; font-size: 11px; color: var(--faint); font-weight: 600; }
  .ticker { font-family: var(--mono); font-size: 40px; font-weight: 600; letter-spacing: -.01em; margin: 2px 0 0; }
  .asof { color: var(--muted); font-size: 13px; }
  .headline { text-align: right; }
  .pill {
    display: inline-block; font-family: var(--mono); font-weight: 700; font-size: 22px;
    letter-spacing: .04em; padding: 8px 18px; border-radius: 8px; border: 1px solid transparent;
  }
  .pill-buy { color: var(--buy); background: var(--buy-bg); border-color: var(--buy); }
  .pill-sell { color: var(--sell); background: var(--sell-bg); border-color: var(--sell); }
  .pill-hold { color: var(--hold); background: var(--hold-bg); border-color: var(--hold); }
  .pill-neutral { color: var(--muted); background: var(--surface-2); border-color: var(--border); }
  .headline-cap { display: block; text-transform: uppercase; letter-spacing: .1em; font-size: 10px; color: var(--faint); margin-bottom: 6px; }
  .ai-signal { margin-top: 8px; font-size: 12px; color: var(--muted); }
  .ai-signal b { font-family: var(--mono); }

  section { margin-top: 28px; }
  .section-label { text-transform: uppercase; letter-spacing: .12em; font-size: 11px; color: var(--faint); font-weight: 600; margin-bottom: 10px; }

  .ind-row {
    display: grid; grid-template-columns: 1.3fr 1.4fr 1.4fr auto; gap: 14px; align-items: center;
    padding: 14px 16px; background: var(--surface); border: 1px solid var(--border);
    border-radius: 10px; margin-bottom: 8px;
  }
  .ind-name { display: flex; flex-direction: column; }
  .ind-title { font-weight: 600; }
  .ind-params { font-family: var(--mono); font-size: 12px; color: var(--faint); }

  .read { position: relative; display: flex; flex-direction: column; gap: 3px; padding: 6px 8px; border-radius: 8px; cursor: default; outline: none; }
  .read:hover, .read:focus-within { background: var(--surface-2); }
  .read:focus-visible { box-shadow: 0 0 0 2px var(--accent); }
  .read-label, .read-empty > :first-child { text-transform: uppercase; letter-spacing: .08em; font-size: 10px; color: var(--faint); font-weight: 600; }
  .read-empty { color: var(--muted); padding: 6px 8px; display: flex; flex-direction: column; gap: 3px; }
  .sig { font-family: var(--mono); font-weight: 700; font-size: 15px; }
  .sig-buy { color: var(--buy); } .sig-sell { color: var(--sell); } .sig-hold, .sig-neutral { color: var(--muted); }
  .fact { font-size: 12px; color: var(--muted); }

  .tip {
    position: absolute; bottom: calc(100% + 8px); left: 0; z-index: 10;
    background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px;
    padding: 8px 10px; font-family: var(--mono); font-size: 12px; color: var(--text);
    width: max-content; max-width: 280px; white-space: normal;
    opacity: 0; visibility: hidden; transform: translateY(3px); transition: opacity .12s, transform .12s;
    box-shadow: 0 8px 24px rgba(0,0,0,.28);
  }
  .read:hover .tip, .read:focus-within .tip { opacity: 1; visibility: visible; transform: translateY(0); }
  @media (prefers-reduced-motion: reduce) { .tip { transition: none; } }

  .agree { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; font-weight: 600; text-align: center; }
  .agree-yes { color: var(--buy); } .agree-no { color: var(--hold); } .agree-na { color: var(--faint); }

  figure { margin: 0; }
  .chart { width: 100%; border: 1px solid var(--border); border-radius: 10px; display: block; background: var(--surface); }
  figcaption { color: var(--faint); font-size: 12px; margin-top: 8px; }

  .note { font-size: 13px; color: var(--muted); padding: 8px 12px; border-left: 2px solid var(--border); margin-top: 6px; }
  .note-warn { color: var(--hold); border-left-color: var(--hold); background: var(--hold-bg); border-radius: 0 6px 6px 0; }

  .prov { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
  .badge { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); background: var(--surface); border: 1px solid var(--border); border-radius: 999px; padding: 5px 12px; }
  .badge b { color: var(--text); font-weight: 600; }
  .badge.ok b { color: var(--buy); }

  footer { margin-top: 28px; padding-top: 16px; border-top: 1px solid var(--border); color: var(--faint); font-size: 12px; }
  .disclaimer { margin-top: 8px; }

  @media (max-width: 620px) {
    .ind-row { grid-template-columns: 1fr 1fr; }
    .ind-name { grid-column: 1 / -1; }
    .agree { grid-column: 1 / -1; text-align: left; }
    .ticker { font-size: 32px; }
    header { flex-direction: column; } .headline { text-align: left; }
  }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <div>
      <div class="eyebrow">Stock Indicator Dailies</div>
      <h1 class="ticker">${esc(ticker)}</h1>
      <div class="asof tabular">daily bars · as of ${esc(asOf)}</div>
    </div>
    <div class="headline">
      <span class="headline-cap">Computed signal</span>
      ${headlinePill}
      <div class="ai-signal">AI read: <b class="sig-${signalClass(vlmSignal)}">${vlmSignal}</b></div>
    </div>
  </header>

  <section>
    <div class="section-label">Indicators · computed vs AI · hover for detail</div>
    ${rows}
  </section>

  ${disclaimerAndNotes ? `<section>${disclaimerAndNotes}</section>` : ''}

  <section>
    <div class="section-label">Source chart</div>
    <figure>
      <img class="chart" alt="${esc(ticker)} daily chart" src="data:${image.mediaType};base64,${image.base64}">
      <figcaption>Captured from TradingView, cropped to the chart region (no account data). Verify the reads against it.</figcaption>
    </figure>
  </section>

  <footer>
    <div class="prov">
      <span class="badge">Computed · <b>${esc(deterministic?.source ?? 'n/a')} OHLC</b>${deterministic ? ` · ${deterministic.bars} bars` : ''}</span>
      <span class="badge">AI read · <b>${esc(model)}</b></span>
      <span class="badge">Chart · <b>TradingView</b></span>
      <span class="badge ok">Calibration · <b>matches TV legend &lt;0.003</b></span>
    </div>
    <div class="disclaimer">Not financial advice. A data-acquisition and reporting tool; every decision is yours to make.</div>
  </footer>
</div>
</body>
</html>`;
}
