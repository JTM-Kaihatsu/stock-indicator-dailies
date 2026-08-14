import type { DeriveSignalOptions } from '@stock-indicator-dailies/shared';
import type { BacktestOptions } from '@stock-indicator-dailies/eval-backtest';

/**
 * The 9 tunable levers, split by where they take effect. `LiveSettings`
 * drives both the live report (client-side recompute) and is global,
 * session-persisted state. `BacktestOnlySettings` only matters once there's
 * a multi-day position to hold/exit — `deriveSignal` has no concept of that
 * for a single-day snapshot — so it lives locally inside Historical Testing,
 * not in global settings.
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

/** Mirrors the backend's actual defaults in packages/shared/src/signal.ts —
 * keep in sync if that ever changes. */
export const DEFAULT_LIVE_SETTINGS: LiveSettings = {
  buyConsensus: 2,
  sellConsensus: 3,
  recencyDays: 3,
};

/** Mirrors evals/backtest/src/simulate.ts's defaults. */
export const DEFAULT_BACKTEST_ONLY_SETTINGS: BacktestOnlySettings = {
  persistenceBars: 1,
  minHoldingDays: 0,
  atrMultiplier: undefined,
  atrPeriod: 14,
  adxThreshold: undefined,
  adxPeriod: 14,
};

export const DEFAULT_SETTINGS: IndicatorSettings = {
  ...DEFAULT_LIVE_SETTINGS,
  ...DEFAULT_BACKTEST_ONLY_SETTINGS,
};

export function mergeSettings(live: LiveSettings, backtestOnly: BacktestOnlySettings): IndicatorSettings {
  return { ...live, ...backtestOnly };
}

const STORAGE_KEY = 'sid:liveSettings:v1';

/** Reads persisted live settings for this browser session. Falls back to
 * defaults on first visit, a parse failure, or when called during SSR.
 * Merges over DEFAULT_LIVE_SETTINGS so a future new field doesn't crash on
 * an older stored blob missing that key. */
export function loadSettings(): LiveSettings {
  if (typeof window === 'undefined') return DEFAULT_LIVE_SETTINGS;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_LIVE_SETTINGS;
    return { ...DEFAULT_LIVE_SETTINGS, ...(JSON.parse(raw) as Partial<LiveSettings>) };
  } catch {
    return DEFAULT_LIVE_SETTINGS;
  }
}

export function saveSettings(settings: LiveSettings): void {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

/** The 3 levers the live report's client-side recompute actually uses. */
export function toLiveOptions(settings: LiveSettings): DeriveSignalOptions {
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

export function isDefault(settings: LiveSettings): boolean {
  return (Object.keys(DEFAULT_LIVE_SETTINGS) as Array<keyof LiveSettings>).every(
    (key) => settings[key] === DEFAULT_LIVE_SETTINGS[key],
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
 * unified scenario/AI-suggestion pellet mechanism. */
export function diffSettings(a: IndicatorSettings, b: IndicatorSettings): SettingsDiffEntry[] {
  return (Object.keys(FIELD_LABELS) as Array<keyof IndicatorSettings>)
    .filter((key) => a[key] !== b[key])
    .map((key) => ({ key, label: FIELD_LABELS[key], from: a[key], to: b[key] }));
}

/** The advisor's proposed-settings shape uses `null` for a disabled
 * ATR/ADX filter (JSON-schema nullable); IndicatorSettings uses `undefined`.
 * Bridges the two so a proposal can flow straight into the backtest form. */
export function fromProposedSettings(proposed: {
  buyConsensus: number; sellConsensus: number; recencyDays: number;
  persistenceBars: number; minHoldingDays: number;
  atrMultiplier?: number | null; atrPeriod: number;
  adxThreshold?: number | null; adxPeriod: number;
}): IndicatorSettings {
  return {
    buyConsensus: proposed.buyConsensus,
    sellConsensus: proposed.sellConsensus,
    recencyDays: proposed.recencyDays,
    persistenceBars: proposed.persistenceBars,
    minHoldingDays: proposed.minHoldingDays,
    atrMultiplier: proposed.atrMultiplier ?? undefined,
    atrPeriod: proposed.atrPeriod,
    adxThreshold: proposed.adxThreshold ?? undefined,
    adxPeriod: proposed.adxPeriod,
  };
}
