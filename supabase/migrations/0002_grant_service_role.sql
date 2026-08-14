-- "Automatically expose new tables" was left off (by design; see 0001), which
-- also withholds base table grants from service_role, not just anon/authenticated.
-- service_role bypasses RLS but still needs an explicit GRANT to touch a table
-- at all. This is the only role that should ever have access to these two.
grant select, insert, update, delete on chart_cache to service_role;
grant select, insert, update, delete on capture_failures to service_role;
grant usage, select on sequence capture_failures_id_seq to service_role;
