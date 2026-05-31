ALTER TABLE epic_conversion_records
  ADD COLUMN IF NOT EXISTS imported_by UUID REFERENCES auth.users(id);

CREATE INDEX IF NOT EXISTS epic_conversion_records_imported_by_idx
  ON epic_conversion_records (imported_by)
  WHERE imported_by IS NOT NULL;
