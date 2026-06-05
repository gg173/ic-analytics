// ============================================================
// Billing Workspace v2 — TypeScript types
// ============================================================

export type PayPeriodStatus = 'not_started' | 'in_progress' | 'finalized';
export type VisitCategory = 'in_person' | 'phone' | 'virtual';
export type DisciplineGroup = 'nursing_psw' | 'rehab';
export type BillingStatus =
  | 'pending'
  | 'clean'
  | 'data_quality'
  | 'needs_investigation'
  | 'billable'
  | 'not_billable';
export type InvestigationType =
  | 'exceptional_duration'
  | 'service_state'
  | 'care_stream_excess'
  | 'virtual_visit_approval';
export type InvestigationStatus = 'open' | 'in_progress' | 'pending_info' | 'closed';
export type InvestigationOutcome =
  | 'pending'
  | 'billable'
  | 'not_billable'
  | 'billable_not_payable'
  | 'not_billable_payable';
export type DqIssueStatus = 'open' | 'resolved';
export type VhaTrack = 'nursing_psw' | 'rehab';

// ── Pay period ─────────────────────────────────────────────

export interface PayPeriod {
  id: string;
  week_start: string;        // ISO date — Monday
  week_end: string;          // ISO date — Sunday
  submission_deadline: string; // ISO timestamptz
  status: PayPeriodStatus;
  initiated_by: string | null;
  initiated_at: string | null;
  finalized_by: string | null;
  finalized_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  // Joined summary (from get_pay_period_summary RPC)
  summary?: PayPeriodSummary;
}

export interface PayPeriodSummary {
  total: number;
  clean: number;
  billable: number;
  not_billable: number;
  data_quality: number;
  needs_investigation: number;
  pending: number;
}

// ── VHA pay cycles (bi-weekly, for dashboard display) ──────

export interface VhaPayCycle {
  id: string;
  track: VhaTrack;
  cycle_start: string;
  cycle_end: string;
  pay_day: string;
  submission_deadline: string;
  created_at: string;
}

// ── Flat file import log ────────────────────────────────────

export interface FlatFileImport {
  id: string;
  pay_period_id: string;
  filename: string;
  file_date: string;
  uploaded_by: string | null;
  uploaded_at: string;
  rows_in_file: number;
  rows_upserted: number;
  rows_skipped: number;
  storage_path: string | null;
  created_at: string;
}

// ── Service visit (billing-workspace view) ──────────────────

export interface BillingVisit {
  id: string;
  pay_period_id: string | null;
  last_import_id: string | null;
  visit_category: VisitCategory | null;
  discipline_group: DisciplineGroup | null;
  billing_status: BillingStatus;
  dq_flag: boolean;
  investigation_flag: boolean;
  // Core fields from flat file
  mrn: string | null;
  service_date: string | null;
  service_time: string | null;
  duration_minutes: number | null;
  employee_first: string | null;
  employee_last: string | null;
  employee_title: string | null;
  employee_discipline: string | null;
  status_of_visit: string | null;
  visit_type: string | null;
  visit_cancel_reason: string | null;
  visit_cancel_reason_description: string | null;
  program_code: string | null;
  bill_to_code: string | null;
  csn: string | null;
  care_stream: string | null;
  is_billable: boolean;
  billing_block_reason: string | null;
  created_at: string;
  updated_at: string;
}

// ── Duration rules ──────────────────────────────────────────

export interface BillingDurationRule {
  id: string;
  visit_category: VisitCategory;
  min_minutes: number;
  max_minutes: number;
  effective_from: string;
  effective_to: string | null;
  change_reason: string | null;
  created_by: string | null;
  created_at: string;
}

// ── Cancellation codes ──────────────────────────────────────

export interface BillingCancellationCode {
  id: string;
  code: string;
  label: string;
  requires_investigation: boolean;
  auto_billable: boolean | null;
  auto_payable: boolean | null;
  spo_perform: boolean | null;
  oh_reporting: boolean | null;
  effective_from: string;
  effective_to: string | null;
  change_reason: string | null;
  created_by: string | null;
  created_at: string;
}

// ── Care streams ────────────────────────────────────────────

export interface BillingCareStream {
  id: string;
  code: string;
  label: string;
  discipline_group: DisciplineGroup;
  max_visits: number;
  period_days: number;
  effective_from: string;
  effective_to: string | null;
  change_reason: string | null;
  created_by: string | null;
  created_at: string;
}

// ── Rule history ────────────────────────────────────────────

export interface BillingRuleHistory {
  id: string;
  table_name: string;
  record_id: string;
  action: 'created' | 'updated' | 'deactivated';
  changed_by: string | null;
  changed_at: string;
  old_value: unknown;
  new_value: unknown;
  change_reason: string | null;
}

// ── Data quality issues ─────────────────────────────────────

export interface DataQualityIssue {
  id: string;
  visit_id: string;
  pay_period_id: string;
  issue_type: string;
  field_name: string | null;
  field_value: string | null;
  message: string;
  status: DqIssueStatus;
  resolution_notes: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

// ── Billing investigations ──────────────────────────────────

/** One step in the Service State Algorithm decision tree */
export interface DecisionTreeStep {
  question_id: string;
  question: string;
  answer: string | null;
  answered_at: string | null;
  answered_by: string | null;
}

export interface BillingInvestigation {
  id: string;
  visit_id: string;
  pay_period_id: string;
  investigation_type: InvestigationType;
  status: InvestigationStatus;
  assigned_to: string | null;
  decision_tree_state: Record<string, DecisionTreeStep>;
  outcome: InvestigationOutcome;
  is_billable: boolean | null;
  is_payable: boolean | null;
  spo_perform: boolean | null;
  oh_reporting: boolean | null;
  cancel_code: string | null;
  outcome_rationale: string | null;
  signed_off_by: string | null;
  signed_off_at: string | null;
  created_at: string;
  updated_at: string;
}

// ── UI helpers ──────────────────────────────────────────────

export const VISIT_CATEGORY_LABELS: Record<VisitCategory, string> = {
  in_person: 'In-Person',
  phone:     'Phone',
  virtual:   'Virtual',
};

export const DISCIPLINE_GROUP_LABELS: Record<DisciplineGroup, string> = {
  nursing_psw: 'Nursing / PSW',
  rehab:       'Rehab',
};

export const BILLING_STATUS_LABELS: Record<BillingStatus, string> = {
  pending:             'Pending',
  clean:               'Clean',
  data_quality:        'Data Quality Issue',
  needs_investigation: 'Needs Investigation',
  billable:            'Billable',
  not_billable:        'Not Billable',
};

export const INVESTIGATION_TYPE_LABELS: Record<InvestigationType, string> = {
  exceptional_duration:   'Exceptional Duration',
  service_state:          'Service State',
  care_stream_excess:     'Care Stream Excess',
  virtual_visit_approval: 'Virtual Visit Approval',
};

export const INVESTIGATION_STATUS_LABELS: Record<InvestigationStatus, string> = {
  open:         'Open',
  in_progress:  'In Progress',
  pending_info: 'Pending Info',
  closed:       'Closed',
};

export const VHA_TRACK_LABELS: Record<VhaTrack, string> = {
  nursing_psw: 'Nursing & PSW',
  rehab:       'Rehab',
};

/** Nursing / PSW employee titles */
export const NURSING_PSW_TITLES = new Set(['RN', 'RPN', 'PSW', 'NSWOC']);

/** Derive discipline group from employee title */
export function getDisciplineGroup(employeeTitle: string | null): DisciplineGroup {
  if (!employeeTitle) return 'rehab';
  return NURSING_PSW_TITLES.has(employeeTitle.trim().toUpperCase())
    ? 'nursing_psw'
    : 'rehab';
}

/** Derive visit category from visit type string */
export function getVisitCategory(visitType: string | null): VisitCategory {
  if (!visitType) return 'in_person';
  const lower = visitType.toLowerCase();
  if (lower.includes('msteams') || lower.includes('virtual')) return 'virtual';
  if (lower.includes('phone')) return 'phone';
  return 'in_person';
}

/** Get Monday of the week for a given date */
export function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay(); // 0 = Sunday
  const diff = day === 0 ? -6 : 1 - day; // adjust to Monday
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function formatWeekLabel(weekStart: string): string {
  const start = new Date(`${weekStart}T12:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
  return `${fmt(start)} – ${fmt(end)}`;
}

export function daysUntilDeadline(deadline: string): number {
  const now = new Date();
  const dl = new Date(deadline);
  return Math.ceil((dl.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}
