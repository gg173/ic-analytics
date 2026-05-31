export type BatchStatus = 'draft' | 'validated' | 'in_review' | 'ready_for_spo' | 'pushed';
export type UserRole =
  | 'app_admin'
  | 'uhn_admin'
  | 'uhn_editor'
  | 'vha_admin'
  | 'ic_lead_hcs'
  | 'spo_viewer';
export type IssueSeverity = 'info' | 'warning' | 'error';
export type IssueResolution = 'pending' | 'approved' | 'corrected' | 'excluded' | 'denied';
export type ApprovalType = 'virtual_visit' | 'visit_limit_excess' | 'duration' | 'title_discipline';
export type ApprovalStatus = 'pending' | 'approved' | 'denied';
export type InvestigationOutcome = 'pending' | 'billable' | 'not_billable' | 'payable' | 'not_payable';
export type AuditAction = 'create' | 'update' | 'delete' | 'status_change' | 'approval' | 'investigation' | 'export' | 'push';
export type PushJobStatus = 'pending' | 'running' | 'success' | 'failed';

export interface Organization {
  id: string;
  slug: string;
  name: string;
}

export interface Profile {
  id?: string;
  user_id: string | null;
  organization_id: string;
  role: UserRole;
  display_name: string | null;
  email: string | null;
  organization?: Organization;
}

export interface BatchUploader {
  display_name: string | null;
  email: string | null;
}

export interface ImportBatch {
  id: string;
  filename: string;
  uploaded_by: string | null;
  uploaded_at: string;
  status: BatchStatus;
  row_count: number;
  issue_count: number;
  notes: string | null;
  storage_path: string | null;
  created_at: string;
  updated_at: string;
  uploader?: BatchUploader | null;
}

export interface ServiceVisit {
  id: string;
  batch_id: string;
  import_row_number: number;
  raw_data: Record<string, unknown>;
  mrn: string | null;
  service_date: string | null;
  service_time: string | null;
  duration_minutes: number | null;
  employee_first: string | null;
  employee_last: string | null;
  employee_number: string | null;
  employee_id: string | null;
  external_id: string | null;
  employee_title: string | null;
  employee_discipline: string | null;
  status_of_visit: string | null;
  visit_type: string | null;
  visit_cancel_reason: string | null;
  visit_cancel_reason_description: string | null;
  program_code: string | null;
  bill_to_code: string | null;
  travel_start_time: string | null;
  travel_end_time: string | null;
  travel_duration: string | null;
  mileage: number | null;
  csn: string | null;
  care_stream: string | null;
  has_quality_issue: boolean;
  needs_virtual_approval: boolean;
  needs_limit_approval: boolean;
  needs_cancellation_investigation: boolean;
  is_billable: boolean;
  billing_block_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface VisitIssue {
  id: string;
  visit_id: string;
  issue_type: string;
  severity: IssueSeverity;
  message: string;
  rule_id: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution: IssueResolution;
  created_at: string;
}

export interface VisitApproval {
  id: string;
  visit_id: string;
  approval_type: ApprovalType;
  status: ApprovalStatus;
  approved_by: string | null;
  notes: string | null;
  external_reference: string | null;
  created_at: string;
  updated_at: string;
}

export interface CancellationInvestigation {
  id: string;
  visit_id: string;
  cancel_reason_code: string | null;
  investigation_status: string;
  outcome: InvestigationOutcome;
  notes: string | null;
  investigated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuditEvent {
  id: string;
  entity_type: string;
  entity_id: string | null;
  batch_id: string | null;
  visit_id: string | null;
  action: AuditAction;
  field_name: string | null;
  old_value: unknown;
  new_value: unknown;
  actor_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface SpoResponse {
  id: string;
  audit_event_id: string | null;
  visit_id: string | null;
  batch_id: string | null;
  body: string;
  author_id: string;
  created_at: string;
}

export interface CareStream {
  id: string;
  code: string;
  name: string;
  visit_limit: number;
  period_days: number;
  active: boolean;
}

export interface RuleTitleDiscipline {
  id: string;
  employee_title: string;
  employee_discipline: string;
  active: boolean;
}

export interface RuleVirtualVisitApproval {
  id: string;
  employee_discipline: string;
  visit_type_pattern: string;
  active: boolean;
}

export interface RuleVisitStatusBillable {
  id: string;
  status_of_visit: string;
  counts_toward_limit: boolean;
  exportable: boolean;
  active: boolean;
}

export interface RuleCancellationReason {
  id: string;
  reason_code: string;
  requires_investigation: boolean;
  default_billable: boolean;
  default_payable: boolean;
  active: boolean;
}

export interface RuleDurationBounds {
  id: string;
  min_minutes: number;
  max_minutes: number;
  active: boolean;
}

export interface PushDestination {
  id: string;
  name: string;
  destination_type: 'webhook' | 'sftp' | 'api';
  url: string | null;
  auth_header_name: string | null;
  auth_header_value: string | null;
  active: boolean;
}

export interface PushJob {
  id: string;
  batch_id: string;
  destination_id: string | null;
  status: PushJobStatus;
  attempts: number;
  response: string | null;
  created_at: string;
  completed_at: string | null;
}

export type VisitFilter =
  | 'all'
  | 'issues'
  | 'duration'
  | 'title_discipline'
  | 'virtual_approval'
  | 'over_limit'
  | 'cancellations'
  | 'ready';

export interface MappedHomecareRow {
  import_row_number: number;
  raw_data: Record<string, unknown>;
  mrn: string | null;
  service_date: string | null;
  service_time: string | null;
  duration_minutes: number | null;
  employee_first: string | null;
  employee_last: string | null;
  employee_number: string | null;
  employee_id: string | null;
  external_id: string | null;
  employee_title: string | null;
  employee_discipline: string | null;
  status_of_visit: string | null;
  visit_type: string | null;
  visit_cancel_reason: string | null;
  visit_cancel_reason_description: string | null;
  program_code: string | null;
  bill_to_code: string | null;
  travel_start_time: string | null;
  travel_end_time: string | null;
  travel_duration: string | null;
  mileage: number | null;
  csn: string | null;
  care_stream: string | null;
}

export const HOMECARE_CSV_COLUMNS = [
  'MRN', 'Service Date', 'Service Time', 'Service Duration',
  'Employee First', 'Employee Last', 'Employee #', 'Employee ID', 'External ID',
  'Employee Title', 'Employee Discipline', 'Status of Visit', 'Visit Type',
  'Visit Cancel Reason', 'Visit Cancel Reason Description',
  'Program Code', 'Bill To Code', 'Travel Start Time', 'Travel End Time',
  'Travel Duration', 'Mileage', 'CSN', 'Care Stream',
] as const;
