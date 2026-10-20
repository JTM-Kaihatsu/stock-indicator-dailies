-- Whether the tracked next_earnings_date is officially confirmed (true) or
-- an estimate (false); null when unknown, including every row cached before
-- this column existed. Previously that status only lived inside the stage-2
-- model's earnings_outlook prose, which a cheap material-update check can't
-- rewrite, so a date that had since been confirmed kept reading "estimate".
-- As a column it can be refreshed by the cheap check and shown by the UI.
alter table advisor_suggestion_cache
  add column if not exists next_earnings_date_confirmed boolean;
