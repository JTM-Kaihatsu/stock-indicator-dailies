import type { DeriveSignalOptions } from '@stock-indicator-dailies/shared';
import type { BacktestOptions } from '@stock-indicator-dailies/eval-backtest';

/**
 * The 9 tunable levers. Only `LiveSettings` has meaning for the live,
 * single-day report — `deriveSignal` doesn't know about a multi-day position,
 * so persistence/holding-period/ATR/ADX only take effect inside Historical
 * Testing (see `toBacktestOptions`).
 */
export interface LiveSettings {
  buyConsensus: number;
  sellConsensus: number;
  recencyDays: number;
}

export interface BacktestOnlySettings {
  persistenceBars: number;
  minHoldingDays: number;
  /** `undefined` disables the ATR noise-reduction filter. */
  atrMultiplier: number | undefined;
  atrPeriod: number;
  /** `undefined` disables the ADX trend-strength gate. */
  adxThreshold: number | undefined;
  adxPeriod: number;
}

export type IndicatorSettings = LiveSettings & BacktestOnlySettings;

/** Mirrors the backend's actual defaults in packages/shared/src/signal.ts and
 * evals/backtest/src/simulate.ts — keep these in sync if those ever change. */
export const DEFAULT_SETTINGS: IndicatorSettings = {
  buyConsensus: 2,
  sellConsensus: 3,
  recencyDays: 3,
  persistenceBars: 1,
  minHoldingDays: 0,
  atrMultiplier: undefined,
  atrPeriod: 14,
  adxThreshold: undefined,
  adxPeriod: 14,
};

const STORAGE_KEY = 'sid:indicatorSettings:v1';

/** Reads persisted settings for this browser session. Falls back to defaults
 * on first visit, a parse failure, or when called during SSR. Merges over
 * DEFAULT_SETTINGS so a future new field added here doesn't crash on an
 * older stored blob missing that key. */
export function loadSettings(): IndicatorSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<IndicatorSettings>) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: IndicatorSettings): void {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

/** The 3 levers the live report's client-side recompute actually uses. */
export function toLiveOptions(settings: IndicatorSettings): DeriveSignalOptions {
  return {
    buyConsensus: settings.buyConsensus,
    sellConsensus: settings.sellConsensus,
    recencyDays: settings.recencyDays,
  };
}

/** The full 9-lever set, for Historical Testing. */
export function toBacktestOptions(settings: IndicatorSettings): BacktestOptions {
  return {
    buyConsensus: settings.buyConsensus,
    sellConsensus: settings.sellConsensus,
    recencyDays: settings.recencyDays,
    persistenceBars: settings.persistenceBars,
    minHoldingDays: settings.minHoldingDays,
    ...(settings.atrMultiplier !== undefined ? { atrMultiplier: settings.atrMultiplier, atrPeriod: settings.atrPeriod } : {}),
    ...(settings.adxThreshold !== undefined ? { adxThreshold: settings.adxThreshold, adxPeriod: settings.adxPeriod } : {}),
  };
}

export function isDefault(settings: IndicatorSettings): boolean {
  return (Object.keys(DEFAULT_SETTINGS) as Array<keyof IndicatorSettings>).every(
    (key) => settings[key] === DEFAULT_SETTINGS[key],
  );
}

export interface SettingsDiffEntry {
  key: keyof IndicatorSettings;
  label: string;
  from: number | undefined;
  to: number | undefined;
}

const FIELD_LABELS: Record<keyof IndicatorSettings, string> = {
  buyConsensus: 'BUY needs at least (of 3)',
  sellConsensus: 'SELL needs at least (of 3)',
  recencyDays: 'Recency window (days)',
  persistenceBars: 'Persistence (bars)',
  minHoldingDays: 'Minimum holding period (days)',
  atrMultiplier: 'ATR multiplier',
  atrPeriod: 'ATR period',
  adxThreshold: 'ADX threshold',
  adxPeriod: 'ADX period',
};

/** Fields that differ between two settings profiles — used by both the
 * scenario comparison and the AI-suggestion diff view. */
export function diffSettings(a: IndicatorSettings, b: IndicatorSettings): SettingsDiffEntry[] {
  return (Object.keys(FIELD_LABELS) as Array<keyof IndicatorSettings>)
    .filter((key) => a[key] !== b[key])
    .map((key) => ({ key, label: FIELD_LABELS[key], from: a[key], to: b[key] }));
}
