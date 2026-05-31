-- ICL Reassessment: track convert/discharge decisions without changing strategy tab.

ALTER TABLE epic_conversion_records
  ADD COLUMN IF NOT EXISTS icl_decision TEXT
    CHECK (icl_decision IS NULL OR icl_decision IN ('convert', 'discharge')),
  ADD COLUMN IF NOT EXISTS icl_decision_by TEXT,
  ADD COLUMN IF NOT EXISTS icl_decision_at TIMESTAMPTZ;
