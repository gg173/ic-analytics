export type ReconciliationOutcome = 'perfect' | 'incorrect' | 'unmatched';

export interface EpicConversionReportImport {
  id: string;
  source_filename: string;
  imported_at: string;
  imported_by: string | null;
  row_count: number;
  created_at: string;
}

export interface EpicConversionReportRow {
  id: string;
  import_id: string;
  enroll_id: string | null;
  mrn: string;
  pathway: string | null;
  hosp_dc_date: string | null;
  ic_lead: string | null;
  row_index: number;
  created_at: string;
}

export interface EpicConversionReconciliationResult {
  id: string;
  import_id: string;
  report_row_id: string;
  matched_record_id: string | null;
  outcome: ReconciliationOutcome;
  field_discrepancies: string[];
  created_at: string;
}

export interface ReconciliationSummary {
  importId: string;
  filename: string;
  importedAt: string;
  totalRows: number;
  perfect: number;
  incorrect: number;
  unmatched: number;
}

export interface ReconciliationDetailRow {
  reportRowId: string;
  rowIndex: number;
  mrn: string;
  pathway: string | null;
  hospDcDate: string | null;
  icLead: string | null;
  outcome: ReconciliationOutcome;
  fieldDiscrepancies: string[];
  matchedRecordId: string | null;
  matchedMrn: string | null;
  matchedPathway: string | null;
  matchedHospDcDate: string | null;
  matchedIcLead: string | null;
}

export const RECONCILIATION_OUTCOME_LABELS: Record<ReconciliationOutcome, string> = {
  perfect: 'Perfect Conversion',
  incorrect: 'Incorrect Conversion',
  unmatched: 'Unmatched Conversion',
};

export const RECONCILIATION_COMPARE_FIELDS = ['mrn', 'pathway', 'hosp_dc_date', 'ic_lead'] as const;

export type ReconciliationCompareField = (typeof RECONCILIATION_COMPARE_FIELDS)[number];

export const RECONCILIATION_FIELD_LABELS: Record<ReconciliationCompareField, string> = {
  mrn: 'MRN',
  pathway: 'Pathway',
  hosp_dc_date: 'Hosp DC Date',
  ic_lead: 'IC Lead',
};
