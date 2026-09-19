import type { DeriveSignalOptions, RiskTolerance } from '@stock-indicator-dailies/shared';
import type { BacktestOptions } from '@stock-indicator-dailies/eval-backtest';

/**
 * The 9 tunable levers, split by where they take effect. `LiveSettings`
 * drives the live report (client-side recompute) and is global, persisted
 * (session storage on the main page; per-ticker on a watchlist row) state.
 * `BacktestOnlySettings` only matters once there's a multi-day position to
 * hold/exit; `deriveSignal` has no concept of that for a single-day
 * snapshot; so it lives locally inside Historical Testing, not in global
 * settings.
 */
export interface LiveSettings {
  buyConsensus: number;
  sellConsensus: number;
  recencyDays: number;
  /**
   * Not read by deriveSignal; carried here because it's edited in the same
   * Indicator Settings panel and persisted the same way, for the AI
   * advisor to use when proposing settings and judging a ticker's fit.
   * Optional (not required, unlike the 3 fields above) specifically so
   * `IndicatorSettings` (this type intersected with `BacktestOnlySettings`,
   * for Historical Testing scenarios) doesn't have to carry a
   * risk-tolerance value everywhere it's built; the backtest simulation
   * itself has no use for it. Always present on the actual live-settings
   * object via DEFAULT_LIVE_SETTINGS/loadSettings, so callers that do care
   * about it can treat it as present there.
   */
  riskTolerance?: RiskTolerance;
  /**
   * Not read by deriveSignal or the live report either; lives here (rather
   * than BacktestOnlySettings) so it persists as a stable, standing value
   * per ticker instead of resetting with whatever's being experimented
   * with in Historical Testing's own scratch fields. This is what a
   * ticker's live position-risk override (see the watchlist position
   * feature) actually computes its stop level from once set, whether set
   * manually here, via "Apply AI Suggestions as the Indicator Settings",
   * or via Historical Testing's "Apply to stock watchlist settings".
   * `undefined` disables the ATR stop-loss / position-risk override.
   */
  atrMultiplier: number | undefined;
  atrPeriod: number;
  /** `undefined` disables the ADX trend-strength gate. Same persistence
   * reasoning as atrMultiplier/atrPeriod above. */
  adxThreshold: number | undefined;
  adxPeriod: number;
}

/** Single source of truth for the 3-way risk-tolerance selector's copy,
 * shared by the Indicator Settings panel and the AI Suggestion panel's
 * per-request override. */
export const RISK_TOLERANCE_OPTIONS: ReadonlyArray<{ value: RiskTolerance; label: string; hint: string }> = [
  { value: 'averse', label: 'Risk-averse', hint: 'Prefers certainty; will choose the lower-risk option.' },
  { value: 'neutral', label: 'Risk-neutral', hint: 'Ignores the element of danger; weighs only the mathematical payoff.' },
  { value: 'seeking', label: 'Risk-seeking', hint: 'Comfortable with fast, higher-variance bets.' },
];

/** Looks up a risk tolerance's display label from RISK_TOLERANCE_OPTIONS.
 * Single source of truth so the AI Suggestion panel's own selector and the
 * read-only "AI analysis suggested..." provenance text (Indicator Settings,
 * Historical Testing) never drift in wording. */
export function riskToleranceLabel(v: RiskTolerance): string {
  return RISK_TOLERANCE_OPTIONS.find((o) => o.value === v)?.label ?? v;
}

export interface BacktestOnlySettings {
  persistenceBars: number;
  minHoldingDays: number;
}

export type IndicatorSettings = LiveSettings & BacktestOnlySettings;

/** Mirrors the backend's actual defaults in packages/shared/src/signal.ts
 * (buyConsensus/sellConsensus/recencyDays) and evals/backtest/src/simulate.ts
 * (atrPeriod/adxPeriod, off by default); keep in sync if those ever change. */
export const DEFAULT_LIVE_SETTINGS: LiveSettings = {
  buyConsensus: 2,
  sellConsensus: 3,
  recencyDays: 3,
  riskTolerance: undefined,
  atrMultiplier: undefined,
  atrPeriod: 14,
  adxThreshold: undefined,
  adxPeriod: 14,
};

/** Mirrors evals/backtest/src/simulate.ts's defaults. */
export const DEFAULT_BACKTEST_ONLY_SETTINGS: BacktestOnlySettings = {
  persistenceBars: 1,
  minHoldingDays: 0,
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

/** Whether the actual sensitivity levers (not riskTolerance, which is just
 * read-only AI-provenance metadata riding along on this type, not itself a
 * lever a user tunes) are all at their defaults. Excluding it means a
 * ticker AI happened to tag with a risk tolerance, but whose numeric
 * settings are otherwise untouched, still reads as "Default", not
 * "Custom": same reasoning DiffableSettingsKey already applies below. */
export function isDefault(settings: LiveSettings): boolean {
  return (Object.keys(DEFAULT_LIVE_SETTINGS) as Array<keyof LiveSettings>)
    .filter((key) => key !== 'riskTolerance')
    .every((key) => settings[key] === DEFAULT_LIVE_SETTINGS[key]);
}

/** The numeric backtest levers Historical Testing's diff view compares.
 * Excludes riskTolerance: it rides along on IndicatorSettings (via
 * LiveSettings) for persistence convenience, but the backtest simulation
 * itself has no concept of it, so it's not a "setting" this diff covers. */
export type DiffableSettingsKey = Exclude<keyof IndicatorSettings, 'riskTolerance'>;

export interface SettingsDiffEntry {
  key: DiffableSettingsKey;
  label: string;
  from: number | undefined;
  to: number | undefined;
}

export const FIELD_LABELS: Record<DiffableSettingsKey, string> = {
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

/** Fields that differ between two settings profiles; used by both the
 * unified scenario/AI-suggestion pellet mechanism. */
export function diffSettings(a: IndicatorSettings, b: IndicatorSettings): SettingsDiffEntry[] {
  return (Object.keys(FIELD_LABELS) as DiffableSettingsKey[])
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
