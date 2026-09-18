-- Supports the AI Suggestion "refresh" flow (see apps/api/src/advisorJobs.ts):
-- a quick, cheap check for whether anything material changed since a
-- suggestion was last generated, before paying for a full re-research.
--
-- next_earnings_date becomes a real date column so "has today passed the
-- earnings date" is a cheap, reliable comparison rather than a string
-- compare. Existing values are already clean ISO dates or null (checked
-- before writing this migration), so a direct cast is safe.
alter table advisor_suggestion_cache
  alter column next_earnings_date type date using next_earnings_date::date;

-- The appended "quick update attempt as of ..." sentence when a refresh
-- finds nothing significant; null means no quick-update note is pending
-- display. Cleared (set back to null) whenever a full regeneration runs.
alter table advisor_suggestion_cache
  add column if not exists quick_update_note text;
