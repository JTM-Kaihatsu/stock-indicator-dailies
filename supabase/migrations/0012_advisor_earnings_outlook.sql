-- Adds the earnings-outlook fields the scoring stage now extracts from
-- research (see packages/advisor/src/tool.ts's PROPOSE_SETTINGS_TOOL):
-- next earnings date, what analysts expect, and a likelihood assessment.
-- These live on advisor_suggestion_cache, not advisor_research_cache: the
-- extraction happens in stage 2 (scoring), not stage 1 (research), so it's
-- scoped the same way fit/fitReason already are.
alter table advisor_suggestion_cache
  add column if not exists next_earnings_date text,
  add column if not exists earnings_outlook text not null default '',
  add column if not exists earnings_likelihood text not null default 'moderate',
  add column if not exists earnings_likelihood_reason text not null default '';

alter table advisor_suggestion_cache alter column earnings_outlook drop default;
alter table advisor_suggestion_cache alter column earnings_likelihood drop default;
alter table advisor_suggestion_cache alter column earnings_likelihood_reason drop default;
