-- Adds the backtest validation result the scoring stage now attaches to
-- its own final proposal (see packages/advisor/src/advisor.ts's
-- scoreForRiskTolerance, which validates candidate settings against a
-- run_backtest tool before finalizing, then runs one more backtest against
-- the settings actually proposed). Nullable: absent on rows cached before
-- this feature existed, and best-effort even for a fresh row (the final
-- validation run itself can fail without failing the whole proposal).
alter table advisor_suggestion_cache
  add column if not exists backtest_result jsonb;
