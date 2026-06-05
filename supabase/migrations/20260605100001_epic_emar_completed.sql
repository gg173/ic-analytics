ALTER TABLE epic_conversion_records
  ADD COLUMN IF NOT EXISTS emar_completed_by TEXT,
  ADD COLUMN IF NOT EXISTS emar_completed_at TIMESTAMPTZ;
