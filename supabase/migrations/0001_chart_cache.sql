-- Chart cache: one row per ticker, overwritten on every fresh fetch.
-- A row is considered fresh for 24h from `retrieved_at`; the API checks that
-- window at read time and treats an expired row as a miss (no separate
-- cleanup job; the next lookup for that ticker just overwrites it).
create table if not exists chart_cache (
  ticker text primary key,
  retrieved_at timestamptz not null default now(),
  -- Full DailyReport minus `image` (the chart PNG lives in Storage instead,
  -- keyed by `image_path`, so this table stays small).
  report jsonb not null,
  image_path text not null
);

alter table chart_cache enable row level security;
-- No policies: only the service_role key (used server-side by the Hono API)
-- can reach this table. The service role bypasses RLS entirely, and no
-- policy means the anon/authenticated roles get nothing.

-- Failed runs, kept separate from the cache so a bad ticker never gets served
-- as if it succeeded. Append-only log for reviewing failure modes.
create table if not exists capture_failures (
  id bigint generated always as identity primary key,
  ticker text not null,
  occurred_at timestamptz not null default now(),
  stage text not null,
  reason text not null,
  errors jsonb not null,
  -- Present only when the capture agent grabbed a diagnostic screenshot
  -- before failing (e.g. studies-not-rendered, wrong-interval).
  image_path text
);

alter table capture_failures enable row level security;
-- Same story: service_role only, no anon/authenticated access.

create index if not exists capture_failures_ticker_idx on capture_failures (ticker, occurred_at desc);
