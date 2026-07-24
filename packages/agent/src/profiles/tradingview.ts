import { INDICATOR_PARAMS, CHART_WINDOW } from '@stock-indicator-dailies/shared';

/** One indicator to add, and the parameter values to set on it. */
export interface IndicatorSpec {
  /** What to type into the provider's "indicators" search box. */
  searchName: string;
  /** Parameter label → value, as shown in the provider's settings dialog. */
  params: Record<string, number>;
}

export interface ChartProviderProfile {
  readonly id: string;
  readonly baseUrl: string;
  /** Deep link straight to a symbol's chart. */
  chartUrl(ticker: string): string;
  /** The range button/token to select, e.g. "3M". */
  readonly rangeToken: string;
  readonly indicators: readonly IndicatorSpec[];
  readonly selectors: {
    /**
     * The chart region to screenshot. MUST be scoped to the chart itself —
     * screenshotting a broader container risks capturing account chrome.
     */
    chartContainer: string;
    /** Presence means we are signed in. */
    signedIn: string;
    /** Presence means we are signed out and must re-authenticate manually. */
    signedOut: string;
  };
}

/**
 * TradingView profile.
 *
 * NOTE: the `selectors` below are a starting point and must be verified against
 * the live DOM — TradingView's markup changes (the PRD's "DOM volatility" risk).
 * The driver fails with `chart-not-found` rather than capturing something wrong.
 */
export const TRADINGVIEW: ChartProviderProfile = {
  id: 'tradingview',
  baseUrl: 'https://www.tradingview.com',
  chartUrl(ticker: string) {
    return `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(ticker.toUpperCase())}`;
  },
  rangeToken: CHART_WINDOW.label,
  indicators: [
    {
      searchName: 'MACD',
      params: {
        'Fast Length': INDICATOR_PARAMS.macd.fastLength,
        'Slow Length': INDICATOR_PARAMS.macd.slowLength,
        'Signal Smoothing': INDICATOR_PARAMS.macd.signalSmoothing,
      },
    },
    {
      searchName: 'Stochastic',
      params: {
        '%K Length': INDICATOR_PARAMS.slowStochastic.percentK,
        '%D Smoothing': INDICATOR_PARAMS.slowStochastic.percentD,
      },
    },
    {
      searchName: 'Moving Average Simple',
      params: {
        Length: INDICATOR_PARAMS.sma.period,
      },
    },
  ],
  selectors: {
    chartContainer: '.chart-gui-wrapper',
    signedIn: '[data-name="header-user-menu"], .tv-header__user-menu-button--logged',
    signedOut: '[data-name="header-user-menu-sign-in"], .tv-header__user-menu-button--anonymous',
  },
};
