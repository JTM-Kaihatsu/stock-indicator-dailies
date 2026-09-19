-- Replaces the single-lot position (entry_date/shares/entry_price on
-- watchlist_tickers) with a proper multi-lot ledger: a user can now record
-- any number of buys and sells over time for a ticker, and realized gains
-- are computed FIFO across them (see apps/api/src/positionRisk.ts).
create table if not exists watchlist_position_lots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  ticker text not null,
  action text not null check (action in ('buy', 'sell')),
  trade_date date not null,
  shares numeric not null check (shares > 0),
  price numeric not null check (price > 0),
  created_at timestamptz not null default now(),
  foreign key (user_id, ticker) references watchlist_tickers (user_id, ticker) on delete cascade
);

alter table watchlist_position_lots enable row level security;
-- Same posture as every other table: service_role only, auth enforced by
-- the Hono API, not RLS policies.
grant select, insert, update, delete on watchlist_position_lots to service_role;

create index if not exists watchlist_position_lots_lookup_idx
  on watchlist_position_lots (user_id, ticker, trade_date, created_at);

-- Backfill: this is real user financial data, not disposable cache, so it
-- gets carried forward as one 'buy' lot rather than dropped outright.
insert into watchlist_position_lots (user_id, ticker, action, trade_date, shares, price)
select user_id, ticker, 'buy', entry_date, shares, entry_price
from watchlist_tickers
where entry_date is not null and shares is not null and entry_price is not null;

alter table watchlist_tickers
  drop column if exists entry_date,
  drop column if exists shares,
  drop column if exists entry_price;
