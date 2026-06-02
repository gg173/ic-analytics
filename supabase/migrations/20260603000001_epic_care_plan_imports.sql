-- VHA EMRI Care Plan template imports

CREATE TABLE epic_conversion_care_plan_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_filename TEXT NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  imported_by UUID REFERENCES auth.users (id) ON DELETE SET NULL,
  row_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX epic_conversion_care_plan_imports_imported_at_idx
  ON epic_conversion_care_plan_imports (imported_at DESC);

CREATE TABLE epic_conversion_care_plan_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id UUID NOT NULL REFERENCES epic_conversion_care_plan_imports (id) ON DELETE CASCADE,
  brn TEXT NOT NULL,
  client_id TEXT,
  offer_id TEXT,
  goldcare_id TEXT,
  patient_name TEXT,
  client_needs_goals TEXT,
  service_teaching_plan TEXT,
  outcomes TEXT,
  goal_met TEXT,
  date_saved DATE,
  row_index INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX epic_conversion_care_plan_rows_import_id_idx
  ON epic_conversion_care_plan_rows (import_id);

CREATE INDEX epic_conversion_care_plan_rows_brn_idx ON epic_conversion_care_plan_rows (brn);

CREATE INDEX epic_conversion_care_plan_rows_goldcare_id_idx
  ON epic_conversion_care_plan_rows (goldcare_id);

ALTER TABLE epic_conversion_care_plan_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE epic_conversion_care_plan_rows ENABLE ROW LEVEL SECURITY;

CREATE POLICY epic_conversion_care_plan_imports_select ON epic_conversion_care_plan_imports
  FOR SELECT TO authenticated USING (can_access_epic_conversion());

CREATE POLICY epic_conversion_care_plan_imports_insert ON epic_conversion_care_plan_imports
  FOR INSERT TO authenticated WITH CHECK (can_access_epic_conversion());

CREATE POLICY epic_conversion_care_plan_imports_delete ON epic_conversion_care_plan_imports
  FOR DELETE TO authenticated USING (can_access_epic_conversion());

CREATE POLICY epic_conversion_care_plan_rows_select ON epic_conversion_care_plan_rows
  FOR SELECT TO authenticated USING (can_access_epic_conversion());

CREATE POLICY epic_conversion_care_plan_rows_insert ON epic_conversion_care_plan_rows
  FOR INSERT TO authenticated WITH CHECK (can_access_epic_conversion());
