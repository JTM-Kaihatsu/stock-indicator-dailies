-- Per-stock sensitivity override: different tickers warrant different
-- BUY/SELL consensus and recency thresholds. Shape matches
-- DeriveSignalOptions (packages/shared/src/signal.ts) exactly, since it's
-- passed straight into recomputeReport as-is. null means "use app defaults."
alter table watchlist_tickers add column if not exists settings jsonb;
