-- Allow reading display names of users who uploaded batches the viewer can access
CREATE POLICY profiles_select_batch_uploaders ON profiles FOR SELECT TO authenticated
  USING (
    user_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM import_batches b
      WHERE b.uploaded_by = profiles.user_id
        AND (
          is_uhn_user()
          OR (is_spo_user() AND b.status IN ('ready_for_spo', 'pushed'))
        )
    )
  );
