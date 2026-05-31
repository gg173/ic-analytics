-- Epic Conversion: standalone patient conversion tracking (no FKs to other app tables)

CREATE TYPE epic_conversion_status AS ENUM ('converted', 'discharged');

CREATE TABLE epic_conversion_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gcn TEXT,
  mrn TEXT NOT NULL,
  pathway TEXT,
  care_path TEXT,
  support_tier TEXT,
  ic_lead TEXT,
  registration_date DATE,
  hosp_dc_date DATE,
  episode_conversion_strategy TEXT,
  los TEXT,
  los_category TEXT,
  latest_srv TEXT,
  days_since_lvd INT,
  lvd DATE,
  lvt TEXT,
  status epic_conversion_status,
  source_filename TEXT NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX epic_conversion_records_imported_at_idx
  ON epic_conversion_records (imported_at DESC);

CREATE INDEX epic_conversion_records_mrn_idx ON epic_conversion_records (mrn);

CREATE OR REPLACE FUNCTION epic_conversion_records_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER epic_conversion_records_updated_at
  BEFORE UPDATE ON epic_conversion_records
  FOR EACH ROW
  EXECUTE FUNCTION epic_conversion_records_set_updated_at();

ALTER TABLE epic_conversion_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY epic_conversion_select ON epic_conversion_records
  FOR SELECT TO authenticated USING (true);

CREATE POLICY epic_conversion_insert ON epic_conversion_records
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY epic_conversion_update ON epic_conversion_records
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY epic_conversion_delete ON epic_conversion_records
  FOR DELETE TO authenticated USING (true);
