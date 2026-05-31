-- Unique enrolment identifier from VHA SSDB export (ENROLL ID column)

ALTER TABLE epic_conversion_records
  ADD COLUMN IF NOT EXISTS enroll_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS epic_conversion_records_enroll_id_key
  ON epic_conversion_records (enroll_id)
  WHERE enroll_id IS NOT NULL;
