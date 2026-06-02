-- Care plan conversion completion (separate from episode conversion completed_at).

ALTER TABLE epic_conversion_records
  ADD COLUMN IF NOT EXISTS care_plan_completed_by TEXT,
  ADD COLUMN IF NOT EXISTS care_plan_completed_at TIMESTAMPTZ;
