import {
  INDICATOR_PARAMS,
  CHART_WINDOW,
  type IndicatorKey,
} from '@stock-indicator-dailies/shared';

/**
 * A study we expect to already be present on the user's saved layout.
 *
 * The agent does not add or configure indicators — it validates that the saved
 * layout still carries them with the expected parameters, and refuses to
 * capture otherwise. `legendPattern` is built from the shared constants so the
 * check can never drift from the spec.
 */
export interface ExpectedStudy {
  key: IndicatorKey;
  label: string;
  legendPattern: RegExp;
}

const { macd, slowStochastic, sma } = INDICATOR_PARAMS;

/**
 * TradingView renders each study's legend as the name, optional source, then its
 * parameters — and then the *live values* run straight on with no separator:
 *
 *   MACDclose8179 0.2454 1.10 0.8504   ->  "MACDclose81790.24541.100.8504"
 *   Stoch1453 70.13 69.18              ->  "Stoch145370.1369.18"
 *   SMA10close 207.45                  ->  "SMA10close207.45"
 *
 * So these are prefix matches — a trailing `\b` would never match, since a
 * parameter digit is followed by a value digit. Only SMA can be tightened (a
 * negative lookahead stops `SMA10` from matching a `SMA100` study), because for
 * MACD/Stoch the very next character is legitimately a digit.
 */
export const TRADINGVIEW_EXPECTED_STUDIES: readonly ExpectedStudy[] = [
  {
    key: 'macd',
    label: `MACD (${macd.fastLength}, ${macd.slowLength}, ${macd.signalSmoothing})`,
    legendPattern: new RegExp(
      `^MACD(close)?${macd.fastLength}${macd.slowLength}${macd.signalSmoothing}`,
    ),
  },
  {
    key: 'slowStochastic',
    label: `Stoch (${slowStochastic.percentKLength}, ${slowStochastic.percentKSmoothing}, ${slowStochastic.percentDSmoothing})`,
    legendPattern: new RegExp(
      `^Stoch${slowStochastic.percentKLength}${slowStochastic.percentKSmoothing}${slowStochastic.percentDSmoothing}`,
    ),
  },
  {
    key: 'sma',
    label: `SMA (${sma.period})`,
    legendPattern: new RegExp(`^SMA${sma.period}(?!\\d)`),
  },
];

export interface ChartProviderProfile {
  readonly id: string;
  readonly baseUrl: string;
  chartUrl(ticker: string): string;
  readonly rangeToken: string;
  /** Bar interval: the URL value to request, and the token shown in the header. */
  readonly interval: { urlParam: string; displayToken: string };
  readonly expectedStudies: readonly ExpectedStudy[];
  readonly selectors: {
    /**
     * Region to screenshot. Scoped to the chart itself — never the full page —
     * so watchlists and account chrome cannot enter the image.
     */
    chartContainer: string;
  };
}

/**
 * TradingView profile. Selectors use `data-name` attributes, which are stable;
 * the CSS class names are build-hashed (`item-JKh7dwEv`) and must not be used.
 *
 * ⚠️ Do NOT use the `date-range-tab-*` buttons to set the window. They are
 * range+interval presets that force an intraday interval — their own aria-labels
 * say so ("3 months in 1 hour intervals", "1 month in 30 minutes intervals").
 * Clicking `3M` silently switches the chart to hourly bars, which would compute
 * a "10-day SMA" over 10 hours. The interval is pinned via the URL instead and
 * verified after load.
 */
export const TRADINGVIEW: ChartProviderProfile = {
  id: 'tradingview',
  baseUrl: 'https://www.tradingview.com',
  chartUrl(ticker: string) {
    const symbol = encodeURIComponent(ticker.toUpperCase());
    return `https://www.tradingview.com/chart/?symbol=${symbol}&interval=D`;
  },
  rangeToken: CHART_WINDOW.label,
  interval: { urlParam: 'D', displayToken: '1D' },
  expectedStudies: TRADINGVIEW_EXPECTED_STUDIES,
  selectors: {
    chartContainer: '.chart-container',
  },
};
