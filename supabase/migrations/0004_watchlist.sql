-- Watchlist: which tickers each authenticated user wants tracked daily.
-- Report DATA is NOT duplicated here; it stays ticker-keyed in the
-- existing chart_cache table (chart data isn't user-specific), so this
-- table is just the user-to-ticker membership list.
create table if not exists watchlist_tickers (
  user_id uuid not null references auth.users (id) on delete cascade,
  ticker text not null,
  added_at timestamptz not null default now(),
  primary key (user_id, ticker)
);

alter table watchlist_tickers enable row level security;
-- Same story as every other table here: service_role only. The Hono API
-- verifies the caller's JWT itself (auth.getUser) and scopes queries by
-- the verified user_id in application code; RLS policies are intentionally
-- not used, to keep exactly one access-control mechanism (the API layer)
-- instead of two.

grant select, insert, update, delete on watchlist_tickers to service_role;

-- Lets the scheduler cheaply enumerate "all distinct tickers across every
-- user's watchlist" without a full table scan.
create index if not exists watchlist_tickers_ticker_idx on watchlist_tickers (ticker);
