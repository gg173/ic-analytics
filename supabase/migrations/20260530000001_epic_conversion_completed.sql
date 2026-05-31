-- Epic Conversion: replace the converted/discharged status select with a single
-- "completed" checkbox that records who checked it and when.

ALTER TABLE epic_conversion_records
  ADD COLUMN IF NOT EXISTS completed_by TEXT,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
