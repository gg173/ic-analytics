export type ReconciliationOutcome =
  | 'validated'
  | 'status_discrepancy'
  | 'field_discrepancy'
  | 'unmatched'
  | 'missing_from_epic'
  /** @deprecated Legacy imports only */
  | 'perfect'
  /** @deprecated Legacy imports only */
  | 'incorrect';

export type ReconciliationOutcomeFilter =
  | 'all'
  | 'validated'
  | 'status_discrepancy'
  | 'field_discrepancy'
  | 'unmatched'
  | 'missing_from_epic';

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
  patient_name: string | null;
  epic_episode: string | null;
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
  validated: number;
  statusDiscrepancy: number;
  fieldDiscrepancy: number;
  unmatched: number;
  missingFromEpic: number;
}

export interface ReconciliationDetailRow {
  reportRowId: string;
  rowIndex: number;
  patientName: string | null;
  mrn: string;
  epicEpisode: string | null;
  pathway: string | null;
  icLead: string | null;
  outcome: ReconciliationOutcome;
  fieldDiscrepancies: string[];
  matchedRecordId: string | null;
  matchedMrn: string | null;
  matchedPathway: string | null;
  matchedIcLead: string | null;
  matchedWorkflowStatus: string | null;
  epicImportFilename: string | null;
}

export const RECONCILIATION_OUTCOME_LABELS: Record<ReconciliationOutcome, string> = {
  validated: 'Validated',
  status_discrepancy: 'Status Discrepancy',
  field_discrepancy: 'Field Discrepancy',
  unmatched: 'Unmatched',
  missing_from_epic: 'Missing from Epic',
  perfect: 'Validated',
  incorrect: 'Field Discrepancy',
};

export const RECONCILIATION_COMPARE_FIELDS = ['mrn', 'pathway', 'ic_lead'] as const;

export type ReconciliationCompareField = (typeof RECONCILIATION_COMPARE_FIELDS)[number];

export const RECONCILIATION_FIELD_LABELS: Record<ReconciliationCompareField, string> = {
  mrn: 'MRN',
  pathway: 'Pathway',
  ic_lead: 'IC Lead',
};
