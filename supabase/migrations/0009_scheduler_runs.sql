-- One row per calendar day (America/New_York) the daily watchlist sweep has
-- run. Existence of today's row is the whole mechanism: claiming it (an
-- insert that no-ops on conflict) is both the "has today already run"
-- check and the guard against a double-fire, in one atomic operation —
-- whether the second attempt comes from a catch-up check racing the normal
-- timer, or two process instances somehow both trying at once.
--
-- Exists specifically because the scheduler's normal trigger is an
-- in-memory setTimeout recomputed fresh on every process boot: a restart
-- that lands after today's fire time (a deploy, a host-level restart, the
-- service not having been continuously up through 7am ET) would otherwise
-- silently compute "next run = tomorrow" and skip today with no trace at
-- all — indistinguishable from every ticker just happening to fail.
create table if not exists scheduler_runs (
  run_date date primary key,
  started_at timestamptz not null default now()
);

alter table scheduler_runs enable row level security;
grant select, insert on scheduler_runs to service_role;
