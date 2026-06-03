import type { CarePlanContentKind } from './classifyCarePlanContent';

export type { CarePlanContentKind } from './classifyCarePlanContent';

export interface EpicCarePlanImport {
  id: string;
  source_filename: string;
  imported_at: string;
  imported_by: string | null;
  row_count: number;
  created_at: string;
}

export interface EpicCarePlanRow {
  id: string;
  import_id: string;
  brn: string;
  client_id: string | null;
  offer_id: string | null;
  goldcare_id: string | null;
  patient_name: string | null;
  client_needs_goals: string | null;
  service_teaching_plan: string | null;
  outcomes: string | null;
  goal_met: string | null;
  date_saved: string | null;
  row_index: number;
  created_at: string;
}

export interface CarePlanInsertRow {
  brn: string;
  client_id: string | null;
  offer_id: string | null;
  goldcare_id: string | null;
  patient_name: string | null;
  client_needs_goals: string | null;
  service_teaching_plan: string | null;
  outcomes: string | null;
  goal_met: string | null;
  date_saved: string | null;
  row_index: number;
}

export type CarePlanEligibilityReason = 'converted' | 'validated' | 'icl_pending';

export type CarePlanPatientFilter =
  | 'all'
  | 'with_care_plan'
  | 'no_care_plan'
  | 'templated'
  | 'unstructured_only'
  | 'update_required';

export interface CarePlanPatientLink {
  recordId: string;
  mrn: string;
  gcn: string | null;
  pathway: string | null;
  carePath: string | null;
  icLead: string | null;
  hospDcDate: string | null;
  /** Last visit date from VHA SSDB enrolment data. */
  lvd: string | null;
  eligibilityReasons: CarePlanEligibilityReason[];
  carePlanCompletedBy: string | null;
  carePlanCompletedAt: string | null;
  carePlanRows: LinkedCarePlanRow[];
}

export interface LinkedCarePlanRow {
  id: string;
  importId: string;
  sourceFilename: string;
  brn: string;
  clientId: string | null;
  offerId: string | null;
  goldcareId: string | null;
  patientName: string | null;
  clientNeedsGoals: string | null;
  clientNeedsKind: CarePlanContentKind;
  serviceTeachingPlan: string | null;
  outcomes: string | null;
  goalMet: string | null;
  dateSaved: string | null;
  rowIndex: number;
}

export interface CarePlanLinkSummary {
  /** All VHA SSDB enrolment records in scope. */
  totalRecordCount: number;
  /** SSDB records matched to at least one uploaded care plan (BRN or GC #). */
  withCarePlanCount: number;
  withoutCarePlanCount: number;
  /** SSDB records with at least one templated care plan. */
  withTemplatedRecordCount: number;
  /** SSDB records whose linked care plans are all unstructured. */
  onlyUnstructuredRecordCount: number;
  /** Linked records whose most recent care plan is before 19 May 2026. */
  carePlanUpdateRequiredCount: number;
}
