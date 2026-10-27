-- Scope: planner choice only while calculating the existing billing lists.
-- Preserves function body, filters, grants, security mode and search_path.
alter function ixc.cobranca_calc(text) set enable_nestloop to off;

-- Rollback:
-- alter function ixc.cobranca_calc(text) reset enable_nestloop;
