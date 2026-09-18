import { yahooDataSource } from '@stock-indicator-dailies/indicators';
import { atr } from '@stock-indicator-dailies/eval-backtest';

export interface Position {
  entryDate: string;
  shares: number;
  entryPrice: number;
}

export interface PositionRisk {
  currentPrice: number;
  peakSinceEntry: number;
  atrValue: number;
  atrMultiplier: number;
  atrPeriod: number;
  stopLevel: number;
  /** True once the current price has fallen through the ATR-based stop
   * level; drives the live Overall-signal override (see routes/watchlist.ts). */
  triggered: boolean;
}

/**
 * Computes a real position's live ATR stop level: the peak close since
 * entryDate, minus atrMultiplier times the current ATR. Unlike the backtest
 * simulator (which tracks a peak-since-entry across a simulated trade),
 * this reads real daily bars for a real user-entered entry date. `null` on
 * any fetch/compute failure (best-effort; a bad ticker or a Yahoo hiccup
 * shouldn't break the whole watchlist dashboard) or when there isn't
 * enough history yet for the requested ATR period.
 */
export async function computePositionRisk(
  ticker: string,
  position: Position,
  atrMultiplier: number,
  atrPeriod: number,
): Promise<PositionRisk | null> {
  try {
    const { bars } = await yahooDataSource.fetchDailyBars(ticker, '2y');
    if (bars.length === 0) return null;

    const atrSeries = atr(bars, atrPeriod);
    const atrValue = atrSeries[atrSeries.length - 1];
    if (atrValue === undefined || Number.isNaN(atrValue)) return null;

    const entryTime = new Date(position.entryDate).getTime();
    const sinceEntry = bars.filter((b) => new Date(b.date).getTime() >= entryTime);
    // A same-day entry (or a date ahead of the latest bar) has nothing in
    // sinceEntry yet; the only sensible peak is today's own close.
    const relevantBars = sinceEntry.length > 0 ? sinceEntry : [bars[bars.length - 1]!];
    const peakSinceEntry = Math.max(...relevantBars.map((b) => b.close));

    const currentPrice = bars[bars.length - 1]!.close;
    const stopLevel = peakSinceEntry - atrMultiplier * atrValue;

    return {
      currentPrice,
      peakSinceEntry,
      atrValue,
      atrMultiplier,
      atrPeriod,
      stopLevel,
      triggered: currentPrice < stopLevel,
    };
  } catch {
    return null;
  }
}

export interface UnrealizedPnl {
  amount: number;
  pct: number;
}

export function computeUnrealizedPnl(position: Position, currentPrice: number): UnrealizedPnl {
  const amount = (currentPrice - position.entryPrice) * position.shares;
  const pct = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
  return { amount, pct };
}
