-- Canonical VHA SSDB service rows (keyed by CALENDAR KEY) with daily ingest status.

DROP TABLE IF EXISTS epic_conversion_ssdb_service_rows;

ALTER TABLE epic_conversion_ssdb_service_imports
  DROP COLUMN IF EXISTS updated_count,
  DROP COLUMN IF EXISTS skipped_count;

ALTER TABLE epic_conversion_ssdb_service_imports
  ADD COLUMN IF NOT EXISTS new_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unchanged_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cancelled_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS skipped_count INT NOT NULL DEFAULT 0;

CREATE TABLE epic_conversion_ssdb_services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  calendar_key TEXT NOT NULL,
  enroll_id TEXT NOT NULL,
  enrolment_record_id UUID REFERENCES epic_conversion_records (id) ON DELETE SET NULL,
  gcn TEXT,
  mrn TEXT NOT NULL,
  region TEXT,
  subregion TEXT,
  fsa TEXT,
  pathway TEXT,
  carepath TEXT,
  reg_date DATE,
  hosp_dc_date DATE,
  srv_date DATE,
  srv_date_pdd TEXT,
  srv_discipline TEXT,
  program TEXT,
  srv_code TEXT,
  srv_code_description TEXT,
  srv_status TEXT,
  srv_delivery_mode TEXT,
  srv_tx_codes TEXT,
  srv_provider_id TEXT,
  srv_provider_designation TEXT,
  start_time TEXT,
  end_time TEXT,
  worked_duration TEXT,
  ingest_status TEXT NOT NULL DEFAULT 'active'
    CHECK (ingest_status IN ('active', 'changed', 'vha_cancelled')),
  first_import_id UUID REFERENCES epic_conversion_ssdb_service_imports (id) ON DELETE SET NULL,
  last_import_id UUID REFERENCES epic_conversion_ssdb_service_imports (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT epic_conversion_ssdb_services_calendar_key_unique UNIQUE (calendar_key)
);

CREATE INDEX epic_conversion_ssdb_services_enroll_id_idx
  ON epic_conversion_ssdb_services (enroll_id);

CREATE INDEX epic_conversion_ssdb_services_ingest_status_idx
  ON epic_conversion_ssdb_services (ingest_status);

CREATE INDEX epic_conversion_ssdb_services_last_import_id_idx
  ON epic_conversion_ssdb_services (last_import_id);

ALTER TABLE epic_conversion_ssdb_services ENABLE ROW LEVEL SECURITY;

CREATE POLICY epic_conversion_ssdb_services_select ON epic_conversion_ssdb_services
  FOR SELECT TO authenticated USING (true);

CREATE POLICY epic_conversion_ssdb_services_insert ON epic_conversion_ssdb_services
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY epic_conversion_ssdb_services_update ON epic_conversion_ssdb_services
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION epic_conversion_ssdb_services_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER epic_conversion_ssdb_services_updated_at
  BEFORE UPDATE ON epic_conversion_ssdb_services
  FOR EACH ROW
  EXECUTE FUNCTION epic_conversion_ssdb_services_set_updated_at();
