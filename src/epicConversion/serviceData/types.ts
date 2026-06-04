export type SsdbServiceIngestStatus = 'active' | 'changed' | 'vha_cancelled';

export interface EpicSsdbServiceImport {
  id: string;
  source_filename: string;
  imported_at: string;
  imported_by: string | null;
  row_count: number;
  new_count: number;
  updated_count: number;
  unchanged_count: number;
  cancelled_count: number;
  skipped_count: number;
}

export interface EpicSsdbService {
  id: string;
  calendar_key: string;
  enroll_id: string;
  enrolment_record_id: string | null;
  gcn: string | null;
  mrn: string;
  region: string | null;
  subregion: string | null;
  fsa: string | null;
  pathway: string | null;
  carepath: string | null;
  reg_date: string | null;
  hosp_dc_date: string | null;
  srv_date: string | null;
  srv_date_pdd: string | null;
  srv_discipline: string | null;
  program: string | null;
  srv_code: string | null;
  srv_code_description: string | null;
  srv_status: string | null;
  srv_delivery_mode: string | null;
  srv_tx_codes: string | null;
  srv_provider_id: string | null;
  srv_provider_designation: string | null;
  start_time: string | null;
  end_time: string | null;
  worked_duration: string | null;
  ingest_status: SsdbServiceIngestStatus;
  first_import_id: string | null;
  last_import_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface SsdbServiceParsedRow {
  calendar_key: string;
  enroll_id: string;
  gcn: string | null;
  mrn: string;
  region: string | null;
  subregion: string | null;
  fsa: string | null;
  pathway: string | null;
  carepath: string | null;
  reg_date: string | null;
  hosp_dc_date: string | null;
  srv_date: string | null;
  srv_date_pdd: string | null;
  srv_discipline: string | null;
  program: string | null;
  srv_code: string | null;
  srv_code_description: string | null;
  srv_status: string | null;
  srv_delivery_mode: string | null;
  srv_tx_codes: string | null;
  srv_provider_id: string | null;
  srv_provider_designation: string | null;
  start_time: string | null;
  end_time: string | null;
  worked_duration: string | null;
}

export interface SsdbServiceIngestSummary {
  newCount: number;
  updatedCount: number;
  unchangedCount: number;
  cancelledCount: number;
  skippedCount: number;
}
