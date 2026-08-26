-- User-controlled display order, editable via drag-reorder on the Manage
-- Watchlist page. Backfilled from the existing added_at ordering so
-- existing watchlists don't visibly reshuffle the moment this ships.
alter table watchlist_tickers add column if not exists sort_order integer;

update watchlist_tickers t
set sort_order = ranked.rn
from (
  select user_id, ticker, row_number() over (partition by user_id order by added_at) as rn
  from watchlist_tickers
) ranked
where t.user_id = ranked.user_id and t.ticker = ranked.ticker and t.sort_order is null;
