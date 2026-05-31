-- Discharge submission audit: who submitted and when.

ALTER TABLE epic_conversion_records
  ADD COLUMN IF NOT EXISTS discharged_by TEXT,
  ADD COLUMN IF NOT EXISTS discharged_at TIMESTAMPTZ;
