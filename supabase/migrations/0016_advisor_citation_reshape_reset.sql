-- The citation shape changed: advisor_research_cache.citations entries went
-- from {claim, sources} to {quote, sources}, and
-- advisor_suggestion_cache.field_citations went from flat arrays of that
-- shape to arrays of {claim, quotes} (synthesized claim + the quotes
-- backing it). Both columns are plain jsonb (no Postgres-level schema), so
-- no column/type change is needed, but existing rows are old-shaped and
-- would otherwise make the redesigned citation drawer crash on read. Reset
-- both to empty rather than leaving stale-shaped data around, even
-- transiently; every ticker's next research/suggestion regenerates them in
-- the new shape (the 7-day cache freshness window means most were due for
-- a refresh soon regardless).
update advisor_research_cache set citations = '[]'::jsonb;
update advisor_suggestion_cache set field_citations = '{}'::jsonb;
