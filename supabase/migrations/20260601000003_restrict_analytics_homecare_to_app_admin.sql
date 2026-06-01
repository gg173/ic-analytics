-- Restrict Analytics and Homecare Billing module access to App Admin only.

CREATE OR REPLACE FUNCTION can_access_homecare()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT is_app_admin();
$$;

CREATE OR REPLACE FUNCTION can_access_analytics()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT is_app_admin();
$$;

-- Core homecare tables (App Admin only)
DROP POLICY IF EXISTS batches_uhn_all ON import_batches;
DROP POLICY IF EXISTS batches_spo_select ON import_batches;
CREATE POLICY batches_homecare ON import_batches FOR ALL TO authenticated
  USING (can_access_homecare()) WITH CHECK (can_access_homecare());

DROP POLICY IF EXISTS visits_uhn_all ON service_visits;
DROP POLICY IF EXISTS visits_spo_select ON service_visits;
CREATE POLICY visits_homecare ON service_visits FOR ALL TO authenticated
  USING (can_access_homecare()) WITH CHECK (can_access_homecare());

DROP POLICY IF EXISTS issues_uhn ON visit_issues;
DROP POLICY IF EXISTS issues_read ON visit_issues;
CREATE POLICY issues_homecare ON visit_issues FOR ALL TO authenticated
  USING (can_access_homecare()) WITH CHECK (can_access_homecare());

DROP POLICY IF EXISTS approvals_uhn ON visit_approvals;
DROP POLICY IF EXISTS approvals_read ON visit_approvals;
CREATE POLICY approvals_homecare ON visit_approvals FOR ALL TO authenticated
  USING (can_access_homecare()) WITH CHECK (can_access_homecare());

DROP POLICY IF EXISTS investigations_uhn ON cancellation_investigations;
DROP POLICY IF EXISTS investigations_read ON cancellation_investigations;
CREATE POLICY investigations_homecare ON cancellation_investigations FOR ALL TO authenticated
  USING (can_access_homecare()) WITH CHECK (can_access_homecare());

DROP POLICY IF EXISTS audit_select ON audit_events;
CREATE POLICY audit_select ON audit_events FOR SELECT TO authenticated
  USING (can_access_homecare());

DROP POLICY IF EXISTS audit_insert ON audit_events;
CREATE POLICY audit_insert ON audit_events FOR INSERT TO authenticated
  WITH CHECK (can_access_homecare());

DROP POLICY IF EXISTS enrollments_uhn ON patient_enrollments;
DROP POLICY IF EXISTS enrollments_read ON patient_enrollments;
CREATE POLICY enrollments_homecare ON patient_enrollments FOR ALL TO authenticated
  USING (can_access_homecare()) WITH CHECK (can_access_homecare());

DROP POLICY IF EXISTS push_jobs_uhn ON push_jobs;
DROP POLICY IF EXISTS push_jobs_spo_select ON push_jobs;
CREATE POLICY push_jobs_homecare ON push_jobs FOR ALL TO authenticated
  USING (can_access_homecare()) WITH CHECK (can_access_homecare());

DROP POLICY IF EXISTS spo_resp_insert ON spo_responses;
DROP POLICY IF EXISTS spo_resp_select ON spo_responses;
CREATE POLICY spo_responses_homecare ON spo_responses FOR ALL TO authenticated
  USING (can_access_homecare()) WITH CHECK (can_access_homecare());

DROP POLICY IF EXISTS push_dest_select ON push_destinations;
CREATE POLICY push_dest_select ON push_destinations FOR SELECT TO authenticated
  USING (can_access_homecare());

DROP POLICY IF EXISTS push_dest_write ON push_destinations;
CREATE POLICY push_dest_write ON push_destinations FOR ALL TO authenticated
  USING (is_uhn_admin() AND can_access_homecare())
  WITH CHECK (is_uhn_admin() AND can_access_homecare());

-- Billing rules (App Admin only)
DROP POLICY IF EXISTS care_streams_write ON care_streams;
CREATE POLICY care_streams_write ON care_streams FOR ALL TO authenticated
  USING (is_uhn_admin() AND can_access_homecare())
  WITH CHECK (is_uhn_admin() AND can_access_homecare());

DROP POLICY IF EXISTS rule_title_write ON rule_title_discipline_map;
CREATE POLICY rule_title_write ON rule_title_discipline_map FOR ALL TO authenticated
  USING (is_uhn_admin() AND can_access_homecare())
  WITH CHECK (is_uhn_admin() AND can_access_homecare());

DROP POLICY IF EXISTS rule_virtual_write ON rule_virtual_visit_approval;
CREATE POLICY rule_virtual_write ON rule_virtual_visit_approval FOR ALL TO authenticated
  USING (is_uhn_admin() AND can_access_homecare())
  WITH CHECK (is_uhn_admin() AND can_access_homecare());

DROP POLICY IF EXISTS rule_status_write ON rule_visit_status_billable;
CREATE POLICY rule_status_write ON rule_visit_status_billable FOR ALL TO authenticated
  USING (is_uhn_admin() AND can_access_homecare())
  WITH CHECK (is_uhn_admin() AND can_access_homecare());

DROP POLICY IF EXISTS rule_cancel_write ON rule_cancellation_reasons;
CREATE POLICY rule_cancel_write ON rule_cancellation_reasons FOR ALL TO authenticated
  USING (is_uhn_admin() AND can_access_homecare())
  WITH CHECK (is_uhn_admin() AND can_access_homecare());

DROP POLICY IF EXISTS rule_duration_write ON rule_duration_bounds;
CREATE POLICY rule_duration_write ON rule_duration_bounds FOR ALL TO authenticated
  USING (is_uhn_admin() AND can_access_homecare())
  WITH CHECK (is_uhn_admin() AND can_access_homecare());

-- Storage
DROP POLICY IF EXISTS homecare_imports_uhn_insert ON storage.objects;
CREATE POLICY homecare_imports_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'homecare-imports' AND can_access_homecare());

DROP POLICY IF EXISTS homecare_imports_uhn_select ON storage.objects;
CREATE POLICY homecare_imports_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'homecare-imports' AND can_access_homecare());

DROP POLICY IF EXISTS homecare_imports_uhn_delete ON storage.objects;
CREATE POLICY homecare_imports_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'homecare-imports' AND can_access_homecare());

-- Profile display names for batch uploaders
DROP POLICY IF EXISTS profiles_select_batch_uploaders ON profiles;
CREATE POLICY profiles_select_batch_uploaders ON profiles FOR SELECT TO authenticated
  USING (
    user_id IS NOT NULL
    AND can_access_homecare()
    AND EXISTS (
      SELECT 1 FROM import_batches b
      WHERE b.uploaded_by = profiles.user_id
    )
  );

CREATE OR REPLACE FUNCTION delete_import_batch(p_batch_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT can_access_homecare() THEN
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
