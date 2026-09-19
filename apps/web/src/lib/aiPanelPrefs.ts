import type { RiskTolerance } from '@stock-indicator-dailies/shared';

/**
 * Remembers the last risk tolerance the user picked in the AI Suggestion
 * panel, per ticker, across browser sessions (localStorage, not the
 * sessionStorage lib/settings.ts uses for LiveSettings): "exit the
 * watchlist and come back" most plausibly means closing the tab and
 * returning later, which sessionStorage wouldn't survive. This is
 * independent of settings.riskTolerance, which is read-only AI-provenance
 * metadata (was this suggestion actually applied), not a user preference.
 */
const STORAGE_KEY = 'sid:aiRiskTolerance:v1';

function readAll(): Record<string, RiskTolerance> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, RiskTolerance>) : {};
  } catch {
    return {};
  }
}

export function loadLastRiskTolerance(ticker: string): RiskTolerance | null {
  return readAll()[ticker] ?? null;
}

export function saveLastRiskTolerance(ticker: string, value: RiskTolerance): void {
  if (typeof window === 'undefined') return;
  try {
    const all = readAll();
    all[ticker] = value;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // Best-effort; losing this preference is not worth failing over.
  }
}
