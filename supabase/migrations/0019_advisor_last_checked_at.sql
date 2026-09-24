-- Tracks when a material-update check (successful or not) was last
-- attempted for a cached suggestion row, independent of retrieved_at
-- (which only moves on a full regeneration; see apps/api/src/advisorCache.ts's
-- recordQuickCheck and checkedRecently). Needed now that the regen
-- decision is earnings-date-driven rather than a fixed calendar window:
-- without a separate timestamp, the cheap check would either never
-- re-run (nothing else advances) or re-run on every single request past
-- the window (retrieved_at never moves), instead of at most once a day.
-- Nullable: absent on rows cached before this feature existed, treated as
-- "never checked" so a check is always attempted at least once.
alter table advisor_suggestion_cache
  add column if not exists last_checked_at timestamptz;
