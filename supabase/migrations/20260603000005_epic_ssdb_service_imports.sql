-- VHA SSDB Service Data uploads: snapshot rows + import metadata (updates existing enrolment records).

CREATE TABLE epic_conversion_ssdb_service_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_filename TEXT NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  imported_by UUID,
  row_count INT NOT NULL DEFAULT 0,
  updated_count INT NOT NULL DEFAULT 0,
  skipped_count INT NOT NULL DEFAULT 0
);

CREATE INDEX epic_conversion_ssdb_service_imports_imported_at_idx
  ON epic_conversion_ssdb_service_imports (imported_at DESC);

CREATE TABLE epic_conversion_ssdb_service_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id UUID NOT NULL REFERENCES epic_conversion_ssdb_service_imports (id) ON DELETE CASCADE,
  row_index INT NOT NULL,
  enroll_id TEXT NOT NULL,
  mrn TEXT NOT NULL,
  lvd DATE,
  lvt TEXT,
  latest_srv TEXT,
  days_since_lvd INT
);

CREATE INDEX epic_conversion_ssdb_service_rows_import_id_idx
  ON epic_conversion_ssdb_service_rows (import_id);

CREATE INDEX epic_conversion_ssdb_service_rows_enroll_id_idx
  ON epic_conversion_ssdb_service_rows (enroll_id);

ALTER TABLE epic_conversion_ssdb_service_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE epic_conversion_ssdb_service_rows ENABLE ROW LEVEL SECURITY;

CREATE POLICY epic_conversion_ssdb_service_imports_select ON epic_conversion_ssdb_service_imports
  FOR SELECT TO authenticated USING (true);

CREATE POLICY epic_conversion_ssdb_service_imports_insert ON epic_conversion_ssdb_service_imports
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY epic_conversion_ssdb_service_imports_delete ON epic_conversion_ssdb_service_imports
  FOR DELETE TO authenticated USING (true);

CREATE POLICY epic_conversion_ssdb_service_rows_select ON epic_conversion_ssdb_service_rows
  FOR SELECT TO authenticated USING (true);

CREATE POLICY epic_conversion_ssdb_service_rows_insert ON epic_conversion_ssdb_service_rows
  FOR INSERT TO authenticated WITH CHECK (true);
