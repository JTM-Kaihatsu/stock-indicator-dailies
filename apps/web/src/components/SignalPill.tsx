import type { Signal, IndicatorSignal } from '@stock-indicator-dailies/shared';

function signalClass(s: Signal | IndicatorSignal): string {
  if (s === 'BUY') return 'pill-buy';
  if (s === 'SELL') return 'pill-sell';
  if (s === 'HOLD') return 'pill-hold';
  return 'pill-neutral';
}

export function SignalPill({ signal, size = 'lg' }: { signal: Signal | IndicatorSignal; size?: 'lg' | 'sm' }) {
  const style = size === 'sm' ? { fontSize: 13, padding: '4px 10px' } : undefined;
  return <span className={`pill ${signalClass(signal)}`} style={style}>{signal}</span>;
}
