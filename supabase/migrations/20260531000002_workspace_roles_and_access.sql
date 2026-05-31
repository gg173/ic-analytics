-- Workspace roles: helpers + RLS (requires 20260531000001_workspace_roles_enum.sql)

CREATE OR REPLACE FUNCTION is_app_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT get_user_role() = 'app_admin';
$$;

CREATE OR REPLACE FUNCTION can_access_homecare()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT is_app_admin()
    OR get_user_role() IN ('uhn_admin', 'uhn_editor', 'spo_viewer');
$$;

CREATE OR REPLACE FUNCTION can_access_analytics()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT is_app_admin()
    OR get_user_role() IN ('uhn_admin', 'uhn_editor', 'vha_admin', 'ic_lead_hcs');
$$;

CREATE OR REPLACE FUNCTION can_access_epic_conversion()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT is_app_admin()
    OR get_user_role() IN ('uhn_admin', 'uhn_editor', 'vha_admin', 'ic_lead_hcs');
$$;

CREATE OR REPLACE FUNCTION is_uhn_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT is_app_admin() OR get_user_role() = 'uhn_admin';
$$;

-- Homecare batches: App Admin sees all; UHN/SPO unchanged
DROP POLICY IF EXISTS batches_uhn_all ON import_batches;
CREATE POLICY batches_uhn_all ON import_batches FOR ALL TO authenticated
  USING (is_uhn_user() OR is_app_admin()) WITH CHECK (is_uhn_user() OR is_app_admin());

DROP POLICY IF EXISTS batches_spo_select ON import_batches;
CREATE POLICY batches_spo_select ON import_batches FOR SELECT TO authenticated
  USING (
    is_app_admin()
    OR (is_spo_user() AND status IN ('ready_for_spo', 'pushed'))
  );

-- Service visits
DROP POLICY IF EXISTS visits_uhn_all ON service_visits;
CREATE POLICY visits_uhn_all ON service_visits FOR ALL TO authenticated
  USING (is_uhn_user() OR is_app_admin()) WITH CHECK (is_uhn_user() OR is_app_admin());

DROP POLICY IF EXISTS visits_spo_select ON service_visits;
CREATE POLICY visits_spo_select ON service_visits FOR SELECT TO authenticated
  USING (
    is_app_admin()
    OR (
      is_spo_user()
      AND EXISTS (
        SELECT 1 FROM import_batches b
        WHERE b.id = service_visits.batch_id
          AND b.status IN ('ready_for_spo', 'pushed')
      )
    )
  );

-- Visit issues read
DROP POLICY IF EXISTS issues_uhn ON visit_issues;
CREATE POLICY issues_uhn ON visit_issues FOR ALL TO authenticated
  USING (is_uhn_user() OR is_app_admin()) WITH CHECK (is_uhn_user() OR is_app_admin());

DROP POLICY IF EXISTS issues_read ON visit_issues;
CREATE POLICY issues_read ON visit_issues FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM service_visits sv
      WHERE sv.id = visit_issues.visit_id
        AND (
          is_uhn_user()
          OR is_app_admin()
          OR (
            is_spo_user()
            AND EXISTS (
              SELECT 1 FROM import_batches b
              WHERE b.id = sv.batch_id AND b.status IN ('ready_for_spo', 'pushed')
            )
          )
        )
    )
  );

DROP POLICY IF EXISTS approvals_uhn ON visit_approvals;
CREATE POLICY approvals_uhn ON visit_approvals FOR ALL TO authenticated
  USING (is_uhn_user() OR is_app_admin()) WITH CHECK (is_uhn_user() OR is_app_admin());

DROP POLICY IF EXISTS investigations_uhn ON cancellation_investigations;
CREATE POLICY investigations_uhn ON cancellation_investigations FOR ALL TO authenticated
  USING (is_uhn_user() OR is_app_admin()) WITH CHECK (is_uhn_user() OR is_app_admin());

DROP POLICY IF EXISTS audit_select ON audit_events;
CREATE POLICY audit_select ON audit_events FOR SELECT TO authenticated
  USING (
    is_uhn_user()
    OR is_app_admin()
    OR (
      is_spo_user()
      AND batch_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM import_batches b
        WHERE b.id = audit_events.batch_id
          AND b.status IN ('ready_for_spo', 'pushed')
      )
    )
  );

-- Rules / push: UHN admin + App Admin
DROP POLICY IF EXISTS push_dest_select ON push_destinations;
CREATE POLICY push_dest_select ON push_destinations FOR SELECT TO authenticated
  USING (is_uhn_user() OR is_app_admin());

DROP POLICY IF EXISTS push_dest_write ON push_destinations;
CREATE POLICY push_dest_write ON push_destinations FOR ALL TO authenticated
  USING (is_uhn_admin()) WITH CHECK (is_uhn_admin());

-- Epic Conversion: restrict to roles with module access
DROP POLICY IF EXISTS epic_conversion_select ON epic_conversion_records;
CREATE POLICY epic_conversion_select ON epic_conversion_records
  FOR SELECT TO authenticated USING (can_access_epic_conversion());

DROP POLICY IF EXISTS epic_conversion_insert ON epic_conversion_records;
CREATE POLICY epic_conversion_insert ON epic_conversion_records
  FOR INSERT TO authenticated WITH CHECK (can_access_epic_conversion());

DROP POLICY IF EXISTS epic_conversion_update ON epic_conversion_records;
CREATE POLICY epic_conversion_update ON epic_conversion_records
  FOR UPDATE TO authenticated
  USING (can_access_epic_conversion()) WITH CHECK (can_access_epic_conversion());

DROP POLICY IF EXISTS epic_conversion_delete ON epic_conversion_records;
CREATE POLICY epic_conversion_delete ON epic_conversion_records
  FOR DELETE TO authenticated USING (can_access_epic_conversion());

DROP POLICY IF EXISTS epic_conversion_report_imports_select ON epic_conversion_report_imports;
CREATE POLICY epic_conversion_report_imports_select ON epic_conversion_report_imports
  FOR SELECT TO authenticated USING (can_access_epic_conversion());

DROP POLICY IF EXISTS epic_conversion_report_imports_insert ON epic_conversion_report_imports;
CREATE POLICY epic_conversion_report_imports_insert ON epic_conversion_report_imports
  FOR INSERT TO authenticated WITH CHECK (can_access_epic_conversion());

DROP POLICY IF EXISTS epic_conversion_report_imports_delete ON epic_conversion_report_imports;
CREATE POLICY epic_conversion_report_imports_delete ON epic_conversion_report_imports
  FOR DELETE TO authenticated USING (can_access_epic_conversion());

DROP POLICY IF EXISTS epic_conversion_report_rows_select ON epic_conversion_report_rows;
CREATE POLICY epic_conversion_report_rows_select ON epic_conversion_report_rows
  FOR SELECT TO authenticated USING (can_access_epic_conversion());

DROP POLICY IF EXISTS epic_conversion_report_rows_insert ON epic_conversion_report_rows;
CREATE POLICY epic_conversion_report_rows_insert ON epic_conversion_report_rows
  FOR INSERT TO authenticated WITH CHECK (can_access_epic_conversion());

DROP POLICY IF EXISTS epic_conversion_reconciliation_results_select ON epic_conversion_reconciliation_results;
CREATE POLICY epic_conversion_reconciliation_results_select ON epic_conversion_reconciliation_results
  FOR SELECT TO authenticated USING (can_access_epic_conversion());

DROP POLICY IF EXISTS epic_conversion_reconciliation_results_insert ON epic_conversion_reconciliation_results;
CREATE POLICY epic_conversion_reconciliation_results_insert ON epic_conversion_reconciliation_results
  FOR INSERT TO authenticated WITH CHECK (can_access_epic_conversion());

DROP POLICY IF EXISTS epic_conversion_reconciliation_results_delete ON epic_conversion_reconciliation_results;
CREATE POLICY epic_conversion_reconciliation_results_delete ON epic_conversion_reconciliation_results
  FOR DELETE TO authenticated USING (can_access_epic_conversion());

-- Batch delete RPC (App Admin + UHN editors)
CREATE OR REPLACE FUNCTION delete_import_batch(p_batch_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (NOT is_uhn_user() AND NOT is_app_admin()) OR is_spo_user() THEN
    RAISE EXCEPTION 'Not authorized to delete batches';
  END IF;

  IF get_user_role() NOT IN ('uhn_editor', 'uhn_admin', 'app_admin') THEN
    RAISE EXCEPTION 'Not authorized to delete batches';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM import_batches WHERE id = p_batch_id) THEN
    RAISE EXCEPTION 'Batch not found';
  END IF;

  DELETE FROM spo_responses
  WHERE batch_id = p_batch_id
     OR visit_id IN (SELECT id FROM service_visits WHERE batch_id = p_batch_id);

  DELETE FROM audit_events
  WHERE batch_id = p_batch_id
     OR visit_id IN (SELECT id FROM service_visits WHERE batch_id = p_batch_id);

  DELETE FROM push_jobs WHERE batch_id = p_batch_id;

  DELETE FROM import_batches WHERE id = p_batch_id;
END;
$$;

DROP POLICY IF EXISTS homecare_imports_uhn_delete ON storage.objects;
CREATE POLICY homecare_imports_uhn_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'homecare-imports'
    AND EXISTS (
      SELECT 1 FROM get_auth_profile() p
      JOIN organizations o ON o.id = p.organization_id
      WHERE (o.slug = 'uhn' OR p.role = 'app_admin')
        AND p.role IN ('uhn_editor', 'uhn_admin', 'app_admin')
    )
  );
