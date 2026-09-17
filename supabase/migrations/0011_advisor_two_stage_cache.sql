-- Splits the AI-suggestion cache into the two stages the advisor now runs
-- as separate steps (see packages/advisor/src/advisor.ts): research
-- (expensive, web-search-backed, the same regardless of risk tolerance)
-- and scoring (cheap, tuned per risk tolerance). advisor_cache conflated
-- both into one ticker-keyed row; that no longer fits now that the same
-- ticker can have up to three scored suggestions (one per risk tolerance).
-- Pure cache data, safe to drop and rebuild from scratch.
drop table if exists advisor_cache;

-- One row per ticker; unaffected by risk tolerance, since research doesn't
-- change based on who's asking. Same week-long TTL reasoning as before: a
-- company's research profile doesn't go stale hour-to-hour.
create table if not exists advisor_research_cache (
  ticker text primary key,
  retrieved_at timestamptz not null default now(),
  research text not null
);

alter table advisor_research_cache enable row level security;
grant select, insert, update, delete on advisor_research_cache to service_role;

-- One row per (ticker, risk tolerance): the same company researched once
-- can be scored differently for a risk-averse vs. risk-seeking investor,
-- so the cache key has to include which one this suggestion is for.
create table if not exists advisor_suggestion_cache (
  ticker text not null,
  risk_tolerance text not null,
  retrieved_at timestamptz not null default now(),
  rationale text not null,
  settings jsonb not null,
  fit text not null,
  fit_reason text not null,
  primary key (ticker, risk_tolerance)
);

alter table advisor_suggestion_cache enable row level security;
grant select, insert, update, delete on advisor_suggestion_cache to service_role;
