-- Speed up cancellation pass: active/changed rows for enroll IDs in the import file.

CREATE INDEX IF NOT EXISTS epic_conversion_ssdb_services_enroll_status_idx
  ON epic_conversion_ssdb_services (enroll_id, ingest_status);
