-- Discharge from Program: date source (LVD/PDD/Other), resolved date, and reason.

ALTER TABLE epic_conversion_records
  ADD COLUMN IF NOT EXISTS discharge_date_source TEXT
    CHECK (discharge_date_source IS NULL OR discharge_date_source IN ('lvd', 'pdd', 'other')),
  ADD COLUMN IF NOT EXISTS discharge_date DATE,
  ADD COLUMN IF NOT EXISTS discharge_reason TEXT;
