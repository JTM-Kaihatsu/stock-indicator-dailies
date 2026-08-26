-- The full 9-field IndicatorSettings shape for a watchlisted ticker's last
-- run scenario/custom backtest, so revisiting the ticker's page can restore
-- and auto-rerun it instead of losing it on remount. Same "null means
-- nothing saved yet" convention as the existing `settings` column.
alter table watchlist_tickers
  add column if not exists scenario_settings jsonb;
