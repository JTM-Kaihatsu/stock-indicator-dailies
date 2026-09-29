/**
 * Session-only tab state for the ad-hoc main page's lookup tabs. Deliberately
 * NOT server-persisted or tied to an account (there's no notion of "the
 * viewer" to save it against, and the request was explicit about not wanting
 * to add one): sessionStorage survives an accidental page reload within the
 * same browser tab, but disappears the moment that browser tab actually
 * closes, which is the right amount of durability for something this
 * disposable.
 *
 * Only the lightweight tab *structure* (id + ticker) lives here. The fetched
 * DailyReport for each tab (which embeds a base64 chart image, too large and
 * too volatile to serialize) is kept in page.tsx's own React state instead,
 * re-fetched via the normal cache-first analyzeDaily on hydration.
 */

export interface TickerTab {
  id: string;
  /** null = a fresh "+"-opened tab with nothing looked up in it yet. */
  ticker: string | null;
}

export const MAX_TABS = 5;

/** The 3 tickers every fresh session starts with -- all real watchlisted
 * tickers whose daily report is normally already warm in the cache, so a
 * first-time (or logged-out) visitor sees something populated immediately
 * rather than a blank lookup box. Not tied to any particular account: the
 * daily report cache itself is ticker-keyed, not user-keyed, so anyone
 * looking these up gets the same cached answer. */
const DEFAULT_TICKERS = ['NVDA', 'GOOG', 'MU'];

const STORAGE_KEY = 'sid.tickerTabs.v1';

export function makeTabId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `tab-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

export interface TabsState {
  tabs: TickerTab[];
  activeId: string;
}

export function defaultTabs(): TabsState {
  const tabs = DEFAULT_TICKERS.map((ticker) => ({ id: makeTabId(), ticker }));
  return { tabs, activeId: tabs[0]!.id };
}

function isValidTab(v: unknown): v is TickerTab {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as { id?: unknown }).id === 'string' &&
    ((v as { ticker?: unknown }).ticker === null || typeof (v as { ticker?: unknown }).ticker === 'string')
  );
}

/** Reads the saved tab structure back, or the 3 defaults on a first visit,
 * a corrupt/foreign value, or when storage itself isn't available (SSR, a
 * private-browsing quirk, storage disabled). Never throws. */
export function loadTabs(): TabsState {
  if (typeof window === 'undefined') return defaultTabs();
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultTabs();
    const parsed = JSON.parse(raw) as { tabs?: unknown; activeId?: unknown };
    if (!Array.isArray(parsed.tabs) || parsed.tabs.length === 0 || !parsed.tabs.every(isValidTab)) return defaultTabs();
    const tabs = (parsed.tabs as TickerTab[]).slice(0, MAX_TABS);
    const activeId = typeof parsed.activeId === 'string' && tabs.some((t) => t.id === parsed.activeId) ? parsed.activeId : tabs[0]!.id;
    return { tabs, activeId };
  } catch {
    return defaultTabs();
  }
}

/** Best-effort; a quota error or disabled storage just means the tab
 * layout won't survive a reload this session, not a broken page. */
export function saveTabs(state: TabsState): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Best-effort.
  }
}
