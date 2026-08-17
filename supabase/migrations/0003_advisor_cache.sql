-- AI-suggestion cache: one row per ticker, overwritten on every fresh
-- research call. Mirrors chart_cache's shape but no Storage bucket is
-- needed since there is no image, just the rationale text and the
-- proposed settings.
--
-- Cached for a week, not 24h like chart_cache: a company's research
-- profile does not go stale hour-to-hour the way a chart does, and the
-- main point of caching this at all is to avoid repeated slow,
-- web-search-backed calls during testing and demos.
create table if not exists advisor_cache (
  ticker text primary key,
  retrieved_at timestamptz not null default now(),
  rationale text not null,
  settings jsonb not null
);

alter table advisor_cache enable row level security;
-- Same story as chart_cache: service_role only, no anon/authenticated
-- access, and no policies since the service role bypasses RLS.

grant select, insert, update, delete on advisor_cache to service_role;
