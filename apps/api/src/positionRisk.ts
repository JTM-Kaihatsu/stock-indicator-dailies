import { yahooDataSource } from '@stock-indicator-dailies/indicators';
import { atr } from '@stock-indicator-dailies/eval-backtest';

/** One recorded buy or sell lot for a ticker. `id`/`createdAt` are only
 * needed to sort/identify rows; the FIFO math itself only cares about
 * action/tradeDate/shares/price. */
export interface PositionLot {
  id: string;
  action: 'buy' | 'sell';
  tradeDate: string;
  shares: number;
  price: number;
  createdAt: string;
}

/** A still-open (not yet fully sold) slice of a buy lot, as left over by
 * FIFO processing. `shares` here can be less than the original buy's
 * shares once partially sold. */
export interface OpenLot {
  tradeDate: string;
  shares: number;
  price: number;
}

export interface LedgerRow {
  lot: PositionLot;
  /** Running total held shares immediately after this lot, in trade order.
   * Goes negative when a sell exceeds what was ever bought by that point;
   * the caller (routes/watchlist.ts) is responsible for rejecting a save
   * that would produce a negative row before trusting the result. */
  totalHeldShares: number;
  /** null for a buy row (a buy never itself realizes anything). */
  realizedGain: number | null;
  realizedGainPct: number | null;
  /** The $ cost basis of the shares consumed by this sell (null for a buy
   * row); exposed so callers can compute a correctly weighted aggregate
   * realized % across every sell (summing cost basis, not averaging
   * per-row percentages, which would misweight sells of different sizes). */
  costBasis: number | null;
}

export interface Ledger {
  rows: LedgerRow[];
  /** The FIFO queue's final state: whatever buy-slices are left unsold.
   * Feeds computePositionRisk's peak-since-entry anchor and
   * computeUnrealizedPnl's cost basis. */
  openLots: OpenLot[];
}

/**
 * Computes the FIFO-accounted ledger for a ticker's full lot history: runs
 * every buy/sell in trade-date order (created_at as a same-day tiebreak)
 * through a FIFO queue of open buy-slices, consuming the oldest slices
 * first on each sell (possibly spanning several buys at different cost
 * bases, summed into that one sell's realized gain). Pure function; does
 * not validate that a sell never exceeds shares held; that's the caller's
 * job before this result is persisted (see routes/watchlist.ts).
 */
export function computeLedger(lots: readonly PositionLot[]): Ledger {
  const sorted = [...lots].sort((a, b) => {
    const byDate = a.tradeDate.localeCompare(b.tradeDate);
    return byDate !== 0 ? byDate : a.createdAt.localeCompare(b.createdAt);
  });

  const queue: OpenLot[] = [];
  const rows: LedgerRow[] = [];
  let totalHeldShares = 0;

  for (const lot of sorted) {
    if (lot.action === 'buy') {
      queue.push({ tradeDate: lot.tradeDate, shares: lot.shares, price: lot.price });
      totalHeldShares += lot.shares;
      rows.push({ lot, totalHeldShares, realizedGain: null, realizedGainPct: null, costBasis: null });
      continue;
    }

    let remaining = lot.shares;
    let costBasis = 0;
    let proceeds = 0;
    while (remaining > 0 && queue.length > 0) {
      const slice = queue[0]!;
      const consumed = Math.min(slice.shares, remaining);
      costBasis += consumed * slice.price;
      proceeds += consumed * lot.price;
      slice.shares -= consumed;
      remaining -= consumed;
      if (slice.shares <= 0) queue.shift();
    }
    totalHeldShares -= lot.shares;
    const realizedGain = proceeds - costBasis;
    const realizedGainPct = costBasis > 0 ? (realizedGain / costBasis) * 100 : null;
    rows.push({ lot, totalHeldShares, realizedGain, realizedGainPct, costBasis });
  }

  return { rows, openLots: queue };
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
 * Computes the live ATR stop level for whatever's currently held: the peak
 * close since the OLDEST still-open lot's trade date, minus atrMultiplier
 * times the current ATR. That anchor is dynamic, not stored: recomputed
 * fresh from `openLots` on every call, so it can jump forward the instant a
 * sell fully drains the previously-oldest lot (correct FIFO behavior, not a
 * bug: the "current holding" genuinely started more recently at that
 * point). `null` when nothing is currently held, or on any fetch/compute
 * failure (best-effort; a bad ticker or a Yahoo hiccup shouldn't break the
 * whole watchlist dashboard) or insufficient history for the ATR period.
 */
export async function computePositionRisk(
  ticker: string,
  openLots: readonly OpenLot[],
  atrMultiplier: number,
  atrPeriod: number,
): Promise<PositionRisk | null> {
  if (openLots.length === 0) return null;

  try {
    const { bars } = await yahooDataSource.fetchDailyBars(ticker, '2y');
    if (bars.length === 0) return null;

    const atrSeries = atr(bars, atrPeriod);
    const atrValue = atrSeries[atrSeries.length - 1];
    if (atrValue === undefined || Number.isNaN(atrValue)) return null;

    const oldestOpenDate = openLots.reduce(
      (min, lot) => (lot.tradeDate < min ? lot.tradeDate : min),
      openLots[0]!.tradeDate,
    );
    const entryTime = new Date(oldestOpenDate).getTime();
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
  /** Total $ cost basis of currently open lots; exposed (alongside
   * LedgerRow.costBasis) so callers can combine unrealized and realized
   * cost bases into a single correctly weighted "Total Value" percentage
   * instead of averaging two already-weighted percentages together. */
  costBasis: number;
}

/** Unrealized P&L across whatever's currently held (the FIFO queue's
 * remaining open slices), each valued at its own cost basis: `amount` sums
 * (currentPrice - lot.price) * lot.shares over every open lot; `pct` is
 * that sum relative to the total cost basis still held. */
export function computeUnrealizedPnl(openLots: readonly OpenLot[], currentPrice: number): UnrealizedPnl | null {
  if (openLots.length === 0) return null;
  const costBasis = openLots.reduce((sum, lot) => sum + lot.price * lot.shares, 0);
  const amount = openLots.reduce((sum, lot) => sum + (currentPrice - lot.price) * lot.shares, 0);
  const pct = costBasis > 0 ? (amount / costBasis) * 100 : 0;
  return { amount, pct, costBasis };
}
