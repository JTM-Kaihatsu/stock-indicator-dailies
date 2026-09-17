-- Whole-watchlist (not per-stock) email alerting: a user opts in once and
-- gets a single daily digest whenever any of their watchlisted tickers'
-- Overall signal transitions into or between BUY/SELL.
--
-- One row per user; absence means notifications are off, same "missing row
-- = default/off" convention watchlist_tickers' settings column already
-- uses. A toggle always upserts (on or off), so "no row" only ever happens
-- for a user who's never touched the setting.
create table if not exists watchlist_notification_prefs (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email_on_signal boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table watchlist_notification_prefs enable row level security;
-- Same story as every other table here: service_role only, verified by the
-- Hono API's own JWT check, not by an RLS policy.
grant select, insert, update, delete on watchlist_notification_prefs to service_role;

-- Per (user, ticker): the last Overall signal the daily notification sweep
-- evaluated for that user, computed with THEIR OWN sensitivity settings
-- (the same value their dashboard shows) — distinct from signal_history,
-- which is ticker-only and always uses app-default settings, so it can't
-- tell whether a signal change is new to a user who's customized a
-- ticker's thresholds. Lets the sweep detect "just changed to BUY/SELL"
-- by comparison instead of re-deriving history on every run.
create table if not exists user_signal_state (
  user_id uuid not null references auth.users (id) on delete cascade,
  ticker text not null,
  overall text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, ticker)
);

alter table user_signal_state enable row level security;
grant select, insert, update, delete on user_signal_state to service_role;
