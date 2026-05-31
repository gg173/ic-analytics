-- Delete import batch and all related rows (visits cascade; audit/push/spo must be cleared first)
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

  DELETE FROM push_jobs WHERE batch_id = p_batch_id;

  DELETE FROM import_batches WHERE id = p_batch_id;
END;
$$;

GRANT EXECUTE ON FUNCTION delete_import_batch(UUID) TO authenticated;

CREATE POLICY homecare_imports_uhn_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'homecare-imports'
    AND EXISTS (
      SELECT 1 FROM get_auth_profile() p
      JOIN organizations o ON o.id = p.organization_id
      WHERE o.slug = 'uhn'
        AND p.role IN ('uhn_editor', 'uhn_admin')
    )
  );
