-- Append-only log of every successfully-captured signal read, one row per
-- fresh capture (not per request; a chart_cache hit never reaches this).
-- Since chart_cache's own 24h freshness window already makes a genuinely
-- fresh capture happen roughly once a day per ticker under normal usage,
-- this naturally comes out to about one row per ticker per day without
-- any extra dedup logic here.
--
-- Logged for every ticker ever captured, not just watchlisted ones: a
-- one-off lookup today still has history if you watchlist it tomorrow.
create table if not exists signal_history (
  id bigint generated always as identity primary key,
  ticker text not null,
  captured_at timestamptz not null default now(),
  -- resolveDualOverall(computed, ai); always present since ai always is.
  overall text not null,
  -- The deterministic read; null on a success where the data fetch itself
  -- failed (best-effort, see run-daily.ts), which is rare but real.
  computed text,
  ai text not null
);

alter table signal_history enable row level security;
-- Same story as every other table here: service_role only, no policies.
-- Only select/insert are granted, unlike the blanket CRUD grants
-- elsewhere; this table is genuinely append-only, nothing here ever
-- updates or deletes a row.
grant select, insert on signal_history to service_role;

create index if not exists signal_history_ticker_captured_idx on signal_history (ticker, captured_at desc);
