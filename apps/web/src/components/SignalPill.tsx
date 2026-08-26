import type { CSSProperties } from 'react';
import type { Signal, IndicatorSignal } from '@stock-indicator-dailies/shared';

function signalClass(s: Signal | IndicatorSignal): string {
  if (s === 'BUY') return 'pill-buy';
  if (s === 'SELL') return 'pill-sell';
  if (s === 'HOLD') return 'pill-hold';
  return 'pill-neutral';
}

export function SignalPill({
  signal,
  size = 'lg',
  fontSize,
  bold = true,
}: {
  signal: Signal | IndicatorSignal;
  size?: 'lg' | 'sm';
  /** Overrides the size-driven default, e.g. to make one column's pill
   * stand out relative to its neighbors without a whole new size variant. */
  fontSize?: number;
  bold?: boolean;
}) {
  const style: CSSProperties = size === 'sm' ? { fontSize: 13, padding: '4px 10px' } : {};
  if (fontSize !== undefined) style.fontSize = fontSize;
  if (!bold) style.fontWeight = 400;
  return <span className={`pill ${signalClass(signal)}`} style={style}>{signal}</span>;
}
