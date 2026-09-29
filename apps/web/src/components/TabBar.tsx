'use client';

import { MAX_TABS, type TickerTab } from '@/lib/tickerTabs';

/** Browser-style tab strip for the ad-hoc main page's up-to-5 lookup tabs
 * (see page.tsx). A tab with no ticker yet (freshly opened via "+") shows
 * as "New tab"; the close control is omitted on the last remaining tab so
 * there's always at least one. */
export function TabBar({
  tabs,
  activeId,
  onSelect,
  onClose,
  onAdd,
}: {
  tabs: TickerTab[];
  activeId: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onAdd: () => void;
}) {
  return (
    <div className="ticker-tabs" role="tablist" aria-label="Looked-up tickers">
      {tabs.map((tab) => (
        <span key={tab.id} className={`ticker-tab${tab.id === activeId ? ' ticker-tab-active' : ''}`}>
          <button
            type="button"
            role="tab"
            aria-selected={tab.id === activeId}
            className="ticker-tab-label"
            onClick={() => onSelect(tab.id)}
          >
            {tab.ticker ?? 'New tab'}
          </button>
          {tabs.length > 1 && (
            <button
              type="button"
              className="ticker-tab-close"
              aria-label={`Close ${tab.ticker ?? 'new tab'}`}
              onClick={(e) => {
                e.stopPropagation();
                onClose(tab.id);
              }}
            >
              ✕
            </button>
          )}
        </span>
      ))}
      {tabs.length < MAX_TABS && (
        <button type="button" className="ticker-tab-add" aria-label="Open a new tab" onClick={onAdd}>
          +
        </button>
      )}
    </div>
  );
}
