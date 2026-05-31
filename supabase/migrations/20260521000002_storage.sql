-- Storage bucket for raw CSV uploads
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('homecare-imports', 'homecare-imports', false, 52428800)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY homecare_imports_uhn_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'homecare-imports'
    AND EXISTS (
      SELECT 1 FROM profiles p
      JOIN organizations o ON o.id = p.organization_id
      WHERE p.user_id = auth.uid() AND o.slug = 'uhn'
    )
  );

CREATE POLICY homecare_imports_uhn_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'homecare-imports'
    AND EXISTS (
      SELECT 1 FROM profiles p
      JOIN organizations o ON o.id = p.organization_id
      WHERE p.user_id = auth.uid() AND o.slug IN ('uhn', 'spo')
    )
  );
