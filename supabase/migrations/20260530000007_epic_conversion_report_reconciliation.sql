-- Epic Conversion Report imports and reconciliation results

CREATE TYPE epic_conversion_reconciliation_outcome AS ENUM ('perfect', 'incorrect', 'unmatched');

CREATE TABLE epic_conversion_report_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_filename TEXT NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  imported_by UUID REFERENCES auth.users (id) ON DELETE SET NULL,
  row_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX epic_conversion_report_imports_imported_at_idx
  ON epic_conversion_report_imports (imported_at DESC);

CREATE TABLE epic_conversion_report_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id UUID NOT NULL REFERENCES epic_conversion_report_imports (id) ON DELETE CASCADE,
  enroll_id TEXT,
  mrn TEXT NOT NULL,
  pathway TEXT,
  hosp_dc_date DATE,
  ic_lead TEXT,
  row_index INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX epic_conversion_report_rows_import_id_idx
  ON epic_conversion_report_rows (import_id);

CREATE INDEX epic_conversion_report_rows_mrn_idx ON epic_conversion_report_rows (mrn);

CREATE TABLE epic_conversion_reconciliation_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id UUID NOT NULL REFERENCES epic_conversion_report_imports (id) ON DELETE CASCADE,
  report_row_id UUID NOT NULL REFERENCES epic_conversion_report_rows (id) ON DELETE CASCADE,
  matched_record_id UUID REFERENCES epic_conversion_records (id) ON DELETE SET NULL,
  outcome epic_conversion_reconciliation_outcome NOT NULL,
  field_discrepancies JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (import_id, report_row_id)
);

CREATE INDEX epic_conversion_reconciliation_results_import_id_idx
  ON epic_conversion_reconciliation_results (import_id);

CREATE INDEX epic_conversion_reconciliation_results_outcome_idx
  ON epic_conversion_reconciliation_results (outcome);

ALTER TABLE epic_conversion_report_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE epic_conversion_report_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE epic_conversion_reconciliation_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY epic_conversion_report_imports_select ON epic_conversion_report_imports
  FOR SELECT TO authenticated USING (true);

CREATE POLICY epic_conversion_report_imports_insert ON epic_conversion_report_imports
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY epic_conversion_report_imports_delete ON epic_conversion_report_imports
  FOR DELETE TO authenticated USING (true);

CREATE POLICY epic_conversion_report_rows_select ON epic_conversion_report_rows
  FOR SELECT TO authenticated USING (true);

CREATE POLICY epic_conversion_report_rows_insert ON epic_conversion_report_rows
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY epic_conversion_reconciliation_results_select ON epic_conversion_reconciliation_results
  FOR SELECT TO authenticated USING (true);

CREATE POLICY epic_conversion_reconciliation_results_insert ON epic_conversion_reconciliation_results
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY epic_conversion_reconciliation_results_delete ON epic_conversion_reconciliation_results
  FOR DELETE TO authenticated USING (true);
