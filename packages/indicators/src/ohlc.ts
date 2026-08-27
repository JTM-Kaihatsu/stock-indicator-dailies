import type { Bar } from './compute.ts';

/** A source of daily OHLC bars. Behind an interface so the math stays testable. */
export interface DailyBarsResult {
  bars: Bar[];
  /** The ticker's display name (e.g. "NVIDIA Corporation" for NVDA), when
   * the source happens to expose one alongside the OHLC data. Absent if the
   * source doesn't carry one; never worth a separate fetch on its own. */
  companyName?: string;
}

export interface DataSource {
  readonly name: string;
  fetchDailyBars(ticker: string, range: string): Promise<DailyBarsResult>;
}

interface YahooChartResponse {
  chart: {
    result?: Array<{
      timestamp?: number[];
      /** Same response as the OHLC data; shortName/longName ride along for
       * free, no separate lookup needed. */
      meta?: { shortName?: string; longName?: string };
      indicators: {
        quote: Array<{
          open?: (number | null)[];
          high?: (number | null)[];
          low?: (number | null)[];
          close?: (number | null)[];
        }>;
      };
    }>;
    error?: { description?: string } | null;
  };
}

/**
 * Keyless daily OHLC from Yahoo Finance's chart endpoint. `range` is a Yahoo
 * token like `6mo` / `1y`. Bars with any null field (holidays, halts) are
 * dropped so the computed series has no gaps.
 */
export const yahooDataSource: DataSource = {
  name: 'yahoo',
  async fetchDailyBars(ticker, range = '1y'): Promise<DailyBarsResult> {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
      ticker.toUpperCase(),
    )}?interval=1d&range=${encodeURIComponent(range)}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) throw new Error(`Yahoo returned ${res.status} for ${ticker}`);

    const body = (await res.json()) as YahooChartResponse;
    const result = body.chart.result?.[0];
    if (!result?.timestamp) {
      throw new Error(`Yahoo returned no data for ${ticker}: ${body.chart.error?.description ?? 'unknown'}`);
    }
    const q = result.indicators.quote[0]!;
    const bars: Bar[] = [];
    for (let i = 0; i < result.timestamp.length; i++) {
      const open = q.open?.[i];
      const high = q.high?.[i];
      const low = q.low?.[i];
      const close = q.close?.[i];
      if (open == null || high == null || low == null || close == null) continue;
      bars.push({
        date: new Date(result.timestamp[i]! * 1000).toISOString().slice(0, 10),
        open,
        high,
        low,
        close,
      });
    }
    return { bars, companyName: result.meta?.longName ?? result.meta?.shortName };
  },
};
