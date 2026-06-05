-- VHA EMRI eMAR imports

CREATE TABLE epic_conversion_emar_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_filename TEXT NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  imported_by UUID REFERENCES auth.users (id) ON DELETE SET NULL,
  row_count INT NOT NULL DEFAULT 0,
  linked_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX epic_conversion_emar_imports_imported_at_idx
  ON epic_conversion_emar_imports (imported_at DESC);

CREATE TABLE epic_conversion_emar_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id UUID NOT NULL REFERENCES epic_conversion_emar_imports (id) ON DELETE CASCADE,
  brn TEXT NOT NULL,
  client_id TEXT,
  offer_id TEXT,
  goldcare_id TEXT,
  medication_name TEXT,
  last_admin_at TEXT,
  dose TEXT,
  route TEXT,
  frequency TEXT,
  total_number_of_doses TEXT,
  order_or_dispensed_date DATE,
  end_date DATE,
  enroll_id TEXT,
  enrolment_record_id UUID REFERENCES epic_conversion_records (id) ON DELETE SET NULL,
  row_index INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX epic_conversion_emar_rows_import_id_idx
  ON epic_conversion_emar_rows (import_id);

CREATE INDEX epic_conversion_emar_rows_brn_idx ON epic_conversion_emar_rows (brn);

CREATE INDEX epic_conversion_emar_rows_goldcare_id_idx
  ON epic_conversion_emar_rows (goldcare_id);

CREATE INDEX epic_conversion_emar_rows_enrolment_record_id_idx
  ON epic_conversion_emar_rows (enrolment_record_id);

ALTER TABLE epic_conversion_emar_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE epic_conversion_emar_rows ENABLE ROW LEVEL SECURITY;

CREATE POLICY epic_conversion_emar_imports_select ON epic_conversion_emar_imports
  FOR SELECT TO authenticated USING (can_access_epic_conversion());

CREATE POLICY epic_conversion_emar_imports_insert ON epic_conversion_emar_imports
  FOR INSERT TO authenticated WITH CHECK (can_access_epic_conversion());

CREATE POLICY epic_conversion_emar_imports_delete ON epic_conversion_emar_imports
  FOR DELETE TO authenticated USING (can_access_epic_conversion());

CREATE POLICY epic_conversion_emar_rows_select ON epic_conversion_emar_rows
  FOR SELECT TO authenticated USING (can_access_epic_conversion());

CREATE POLICY epic_conversion_emar_rows_insert ON epic_conversion_emar_rows
  FOR INSERT TO authenticated WITH CHECK (can_access_epic_conversion());
