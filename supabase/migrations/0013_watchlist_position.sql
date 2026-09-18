-- A user-entered real position for a watchlisted ticker: when they bought,
-- how many shares, and at what price. Powers unrealized gains/losses and
-- the live ATR-based sell-point override (see apps/api/src/positionRisk.ts).
-- All three are set/cleared together (see updatePosition in watchlist.ts),
-- so there's no meaningful state where only some of them are present.
alter table watchlist_tickers
  add column if not exists entry_date date,
  add column if not exists shares numeric,
  add column if not exists entry_price numeric;
