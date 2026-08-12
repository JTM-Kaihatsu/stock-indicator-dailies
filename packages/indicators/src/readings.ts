import {
  INDICATOR_PARAMS,
  MACD_ZERO_DEADZONE_PCT,
  STOCHASTIC_THRESHOLDS,
  type IndicatorReading,
} from '@stock-indicator-dailies/shared';

import { macdSeries, sma, stochasticSeries, type Bar } from './compute.ts';
import { detectCrossover } from './crossovers.ts';
import type { IndicatorValues } from './values.ts';

/** Assemble a fact reading, matching the VLM's `IndicatorReading` shape. */
function reading(
  indicator: IndicatorReading['indicator'],
  crossover: IndicatorReading['crossover'],
  barsAgo: number | undefined,
  qualified: boolean,
): IndicatorReading {
  return {
    indicator,
    crossover,
    qualified,
    ...(crossover !== 'NONE' && barsAgo !== undefined ? { barsAgo } : {}),
  };
}

/**
 * Ground-truth per-indicator FACTS computed from the price series — the same
 * `{crossover, barsAgo, qualified}` the VLM reports, so the two can be compared
 * directly. This is the event-capable oracle (it sees history, unlike the
 * single-bar legend oracle).
 */
export function computeReadings(bars: readonly Bar[]): IndicatorReading[] {
  const closes = bars.map((b) => b.close);
  const { macd, sma: smaP, slowStochastic } = INDICATOR_PARAMS;

  // --- MACD: qualified if the cross was below zero (bullish) / above zero (bearish) ---
  // Dead zone: if the cross is within MACD_ZERO_DEADZONE_PCT of the recent
  // range from zero, it's too close to call — treat as qualified either way.
  const macdS = macdSeries(closes, macd.fastLength, macd.slowLength, macd.signalSmoothing);
  const macdX = detectCrossover(macdS.macd, macdS.signal);
  const macdValAtCross = macdX.direction !== 'NONE' ? macdS.macd[macdX.atIndex]! : 0;
  const macdRange = Math.max(...macdS.macd.filter((v) => !Number.isNaN(v))) -
    Math.min(...macdS.macd.filter((v) => !Number.isNaN(v)));
  const inDeadZone = macdRange > 0 && Math.abs(macdValAtCross) / macdRange < MACD_ZERO_DEADZONE_PCT;
  const macdQualified =
    macdX.direction === 'NONE'
      ? false
      : inDeadZone
        ? true
        : macdX.direction === 'BULLISH'
          ? macdValAtCross < 0
          : macdValAtCross > 0;

  // --- Slow Stochastic: qualified if the cross was in oversold / overbought ---
  const stoch = stochasticSeries(
    bars,
    slowStochastic.percentKLength,
    slowStochastic.percentKSmoothing,
    slowStochastic.percentDSmoothing,
  );
  const stochX = detectCrossover(stoch.percentK, stoch.percentD);
  const stochQualified =
    stochX.direction === 'BULLISH'
      ? stoch.percentK[stochX.atIndex]! < STOCHASTIC_THRESHOLDS.oversold
      : stochX.direction === 'BEARISH'
        ? stoch.percentK[stochX.atIndex]! > STOCHASTIC_THRESHOLDS.overbought
        : false;

  // --- SMA: crossover of price over the SMA; qualified by SMA slope direction ---
  const smaSeries = sma(closes, smaP.period);
  const smaX = detectCrossover(closes, smaSeries);
  const smaSlopeUp =
    smaX.atIndex > 0 && smaSeries[smaX.atIndex]! > smaSeries[smaX.atIndex - 1]!;
  const smaQualified =
    smaX.direction === 'BULLISH'
      ? smaSlopeUp
      : smaX.direction === 'BEARISH'
        ? !smaSlopeUp
        : false;

  return [
    reading('macd', macdX.direction, macdX.barsAgo, macdQualified),
    reading('slowStochastic', stochX.direction, stochX.barsAgo, stochQualified),
    reading('sma', smaX.direction, smaX.barsAgo, smaQualified),
  ];
}

/** The indicator values at the last bar — used to calibrate against the legend. */
export function computeLastBar(bars: readonly Bar[]): IndicatorValues {
  const closes = bars.map((b) => b.close);
  const { macd, smaP, stoch } = {
    macd: macdSeries(
      closes,
      INDICATOR_PARAMS.macd.fastLength,
      INDICATOR_PARAMS.macd.slowLength,
      INDICATOR_PARAMS.macd.signalSmoothing,
    ),
    smaP: sma(closes, INDICATOR_PARAMS.sma.period),
    stoch: stochasticSeries(
      bars,
      INDICATOR_PARAMS.slowStochastic.percentKLength,
      INDICATOR_PARAMS.slowStochastic.percentKSmoothing,
      INDICATOR_PARAMS.slowStochastic.percentDSmoothing,
    ),
  };
  const i = bars.length - 1;
  return {
    macd: { macd: macd.macd[i]!, signal: macd.signal[i]!, histogram: macd.histogram[i]! },
    stochastic: { percentK: stoch.percentK[i]!, percentD: stoch.percentD[i]! },
    sma: smaP[i]!,
    close: closes[i]!,
  };
}
