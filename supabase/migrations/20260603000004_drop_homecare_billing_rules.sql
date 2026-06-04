-- Remove homecare billing rules configuration tables, validation RPCs, and push destinations.

DROP FUNCTION IF EXISTS validate_batch(UUID);
DROP FUNCTION IF EXISTS check_visit_limits_for_batch(UUID);

DROP POLICY IF EXISTS push_jobs_uhn ON push_jobs;
DROP POLICY IF EXISTS push_jobs_spo_select ON push_jobs;
DROP POLICY IF EXISTS push_dest_select ON push_destinations;
DROP POLICY IF EXISTS push_dest_write ON push_destinations;

DROP POLICY IF EXISTS enrollments_uhn ON patient_enrollments;
DROP POLICY IF EXISTS enrollments_read ON patient_enrollments;

DROP POLICY IF EXISTS care_streams_select ON care_streams;
DROP POLICY IF EXISTS care_streams_write ON care_streams;
DROP POLICY IF EXISTS rule_title_select ON rule_title_discipline_map;
DROP POLICY IF EXISTS rule_title_write ON rule_title_discipline_map;
DROP POLICY IF EXISTS rule_virtual_select ON rule_virtual_visit_approval;
DROP POLICY IF EXISTS rule_virtual_write ON rule_virtual_visit_approval;
DROP POLICY IF EXISTS rule_status_select ON rule_visit_status_billable;
DROP POLICY IF EXISTS rule_status_write ON rule_visit_status_billable;
DROP POLICY IF EXISTS rule_cancel_select ON rule_cancellation_reasons;
DROP POLICY IF EXISTS rule_cancel_write ON rule_cancellation_reasons;
DROP POLICY IF EXISTS rule_duration_select ON rule_duration_bounds;
DROP POLICY IF EXISTS rule_duration_write ON rule_duration_bounds;

DROP TABLE IF EXISTS push_jobs;
DROP TABLE IF EXISTS push_destinations;
DROP TABLE IF EXISTS patient_enrollments;
DROP TABLE IF EXISTS rule_title_discipline_map;
DROP TABLE IF EXISTS rule_virtual_visit_approval;
DROP TABLE IF EXISTS rule_visit_status_billable;
DROP TABLE IF EXISTS rule_cancellation_reasons;
DROP TABLE IF EXISTS rule_duration_bounds;
DROP TABLE IF EXISTS care_streams;

DROP TYPE IF EXISTS push_job_status;
DROP TYPE IF EXISTS push_destination_type;

CREATE OR REPLACE FUNCTION delete_import_batch(p_batch_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_uhn_user() OR is_spo_user() THEN
    RAISE EXCEPTION 'Not authorized to delete batches';
  END IF;

  IF get_user_role() NOT IN ('uhn_editor', 'uhn_admin') THEN
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

  DELETE FROM import_batches WHERE id = p_batch_id;
END;
$$;
