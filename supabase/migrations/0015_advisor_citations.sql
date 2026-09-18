-- Supports per-field source citations in the AI Suggestion panel: for each
-- of rationale/fitReason/earningsOutlook/earningsLikelihoodReason, which
-- specific research claims (with their sources) backed it.
--
-- advisor_research_cache.citations holds Gemini's own grounding-metadata
-- citations for the whole research brief (claim text + sources), keyed by
-- ticker like the rest of that table.
alter table advisor_research_cache
  add column if not exists citations jsonb not null default '[]'::jsonb;

-- advisor_suggestion_cache.field_citations holds which of those citations
-- stage 2 (Claude) attributed to each of its own output fields, already
-- resolved to full claim+sources objects (not just indices) so a cached
-- suggestion stays self-contained even if research is later regenerated.
alter table advisor_suggestion_cache
  add column if not exists field_citations jsonb not null default '{}'::jsonb;
