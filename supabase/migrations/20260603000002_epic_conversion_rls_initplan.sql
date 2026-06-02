-- Epic Conversion RLS: evaluate can_access_epic_conversion() once per query.
-- Without (SELECT ...), Postgres may re-run the function per row and hit statement_timeout
-- on large tables (e.g. epic_conversion_report_rows, epic_conversion_care_plan_rows).

SET lock_timeout = '120s';

ALTER POLICY epic_conversion_care_plan_rows_select ON epic_conversion_care_plan_rows
  USING ((SELECT can_access_epic_conversion()));

ALTER POLICY epic_conversion_care_plan_rows_insert ON epic_conversion_care_plan_rows
  WITH CHECK ((SELECT can_access_epic_conversion()));

ALTER POLICY epic_conversion_care_plan_imports_select ON epic_conversion_care_plan_imports
  USING ((SELECT can_access_epic_conversion()));

ALTER POLICY epic_conversion_care_plan_imports_insert ON epic_conversion_care_plan_imports
  WITH CHECK ((SELECT can_access_epic_conversion()));

ALTER POLICY epic_conversion_care_plan_imports_delete ON epic_conversion_care_plan_imports
  USING ((SELECT can_access_epic_conversion()));

ALTER POLICY epic_conversion_report_rows_select ON epic_conversion_report_rows
  USING ((SELECT can_access_epic_conversion()));

ALTER POLICY epic_conversion_report_rows_insert ON epic_conversion_report_rows
  WITH CHECK ((SELECT can_access_epic_conversion()));

ALTER POLICY epic_conversion_report_imports_select ON epic_conversion_report_imports
  USING ((SELECT can_access_epic_conversion()));

ALTER POLICY epic_conversion_report_imports_insert ON epic_conversion_report_imports
  WITH CHECK ((SELECT can_access_epic_conversion()));

ALTER POLICY epic_conversion_report_imports_delete ON epic_conversion_report_imports
  USING ((SELECT can_access_epic_conversion()));

ALTER POLICY epic_conversion_reconciliation_results_select ON epic_conversion_reconciliation_results
  USING ((SELECT can_access_epic_conversion()));

ALTER POLICY epic_conversion_reconciliation_results_insert ON epic_conversion_reconciliation_results
  WITH CHECK ((SELECT can_access_epic_conversion()));

ALTER POLICY epic_conversion_reconciliation_results_delete ON epic_conversion_reconciliation_results
  USING ((SELECT can_access_epic_conversion()));

ALTER POLICY epic_conversion_select ON epic_conversion_records
  USING ((SELECT can_access_epic_conversion()));

ALTER POLICY epic_conversion_insert ON epic_conversion_records
  WITH CHECK ((SELECT can_access_epic_conversion()));

ALTER POLICY epic_conversion_update ON epic_conversion_records
  USING ((SELECT can_access_epic_conversion()))
  WITH CHECK ((SELECT can_access_epic_conversion()));

ALTER POLICY epic_conversion_delete ON epic_conversion_records
  USING ((SELECT can_access_epic_conversion()));
