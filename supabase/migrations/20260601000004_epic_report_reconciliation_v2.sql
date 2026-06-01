-- Epic report: store raw export fields and extend reconciliation outcomes

ALTER TABLE epic_conversion_report_rows
  ADD COLUMN IF NOT EXISTS patient_name TEXT,
  ADD COLUMN IF NOT EXISTS epic_episode TEXT;

ALTER TYPE epic_conversion_reconciliation_outcome ADD VALUE IF NOT EXISTS 'validated';
ALTER TYPE epic_conversion_reconciliation_outcome ADD VALUE IF NOT EXISTS 'status_discrepancy';
ALTER TYPE epic_conversion_reconciliation_outcome ADD VALUE IF NOT EXISTS 'field_discrepancy';
