import { useEffect, useState } from 'react';
import type { InvestigationOutcome, ServiceVisit, VisitFilter, VisitIssue } from '../types';
import type { ServiceVisitRow } from '../hooks/useVisits';

const EDITABLE_FIELDS = [
  'care_stream',
  'duration_minutes',
  'employee_title',
  'employee_discipline',
  'visit_type',
  'status_of_visit',
] as const satisfies readonly (keyof ServiceVisit)[];

type EditableField = (typeof EDITABLE_FIELDS)[number];
type VisitDraft = Record<EditableField, string>;

const FILTERS: { id: VisitFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'issues', label: 'All issues' },
  { id: 'duration', label: 'Duration' },
  { id: 'title_discipline', label: 'Title/Discipline' },
  { id: 'virtual_approval', label: 'Virtual approval' },
  { id: 'over_limit', label: 'Over limit' },
  { id: 'cancellations', label: 'Cancellations' },
  { id: 'ready', label: 'Ready to export' },
];

export function VisitFilterBar({
  filter,
  onFilterChange,
  loading,
  visitCount,
}: {
  filter: VisitFilter;
  onFilterChange: (f: VisitFilter) => void;
  loading: boolean;
  visitCount: number;
}) {
  return (
    <div className="hc-filter-bar" role="toolbar" aria-label="Visit filters">
      {FILTERS.map((f) => (
        <button
          key={f.id}
          type="button"
          className={`hc-chip${filter === f.id ? ' hc-chip--active' : ''}`}
          onClick={() => onFilterChange(f.id)}
        >
          {f.label}
        </button>
      ))}
      {!loading && (
        <span className="hc-muted hc-visit-count">
          {visitCount} visit{visitCount === 1 ? '' : 's'}
        </span>
      )}
    </div>
  );
}

interface VisitGridProps {
  visits: ServiceVisitRow[];
  loading: boolean;
  canEdit: boolean;
  editingId: string | null;
  onStartEdit: (visit: ServiceVisit) => void;
  onCancelEdit: () => void;
  onSaveRow: (visitId: string, updates: Partial<ServiceVisit>) => Promise<void>;
}

function visitToDraft(v: ServiceVisit): VisitDraft {
  return {
    care_stream: v.care_stream ?? '',
    duration_minutes: v.duration_minutes != null ? String(v.duration_minutes) : '',
    employee_title: v.employee_title ?? '',
    employee_discipline: normalizeDiscipline(v.employee_discipline),
    visit_type: v.visit_type ?? '',
    status_of_visit: v.status_of_visit ?? '',
  };
}

function draftToUpdates(draft: VisitDraft, original: ServiceVisit): Partial<ServiceVisit> {
  const updates: Partial<ServiceVisit> = {};
  for (const field of EDITABLE_FIELDS) {
    const draftVal = draft[field];
    const origVal = original[field];
    const normalized =
      field === 'duration_minutes'
        ? draftVal.trim() === ''
          ? null
          : parseFloat(draftVal) || null
        : draftVal.trim() === ''
          ? null
          : draftVal.trim();
    if (normalized !== origVal) {
      (updates as Record<string, unknown>)[field] = normalized;
    }
  }
  return updates;
}

function cell(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === '') return '—';
  return String(v);
}

function formatEmployeeName(last: string | null, first: string | null): string {
  const lastUpper = (last ?? '').trim().toUpperCase();
  const initial = (first ?? '').trim().charAt(0).toUpperCase();
  if (!lastUpper && !initial) return '—';
  if (!lastUpper) return initial;
  return initial ? `${lastUpper} ${initial}` : lastUpper;
}

const DISCIPLINE_OPTIONS = [
  'Nursing',
  'Personal Support',
  'Occupational Therapy',
  'Physiotherapy',
  'Respiratory Therapy',
  'Speech-Language Pathology',
  'NSWOC',
  'Social Work',
] as const;

const DISCIPLINE_ALIASES: Record<string, (typeof DISCIPLINE_OPTIONS)[number]> = {
  NURSING: 'Nursing',
  NS: 'Nursing',
  'PERSONAL SUPPORT WORKER': 'Personal Support',
  PSW: 'Personal Support',
  'PERSONAL SUPPORT': 'Personal Support',
  OT: 'Occupational Therapy',
  'OCCUPATIONAL THERAPY': 'Occupational Therapy',
  PT: 'Physiotherapy',
  PHYSIOTHERAPY: 'Physiotherapy',
  'PHYSICAL THERAPY': 'Physiotherapy',
  RA: 'Rehab Assistant',
  'REHAB ASSISTANT': 'Rehab Assistant',
  RT: 'Respiratory Therapy',
  'RESPIRATORY THERAPY': 'Respiratory Therapy',
  SLP: 'Speech-Language Pathology',
  'SPEECH-LANGUAGE PATHOLOGY': 'Speech-Language Pathology',
  'SPEECH LANGUAGE PATHOLOGY': 'Speech-Language Pathology',
  NSWOC: 'NSWOC',
  SW: 'Social Work',
  'SOCIAL WORK': 'Social Work',
};

function normalizeDiscipline(discipline: string | null | undefined): string {
  if (!discipline?.trim()) return '';
  const trimmed = discipline.trim();
  const alias = DISCIPLINE_ALIASES[trimmed.toUpperCase()];
  if (alias) return alias;
  const match = DISCIPLINE_OPTIONS.find((opt) => opt.toLowerCase() === trimmed.toLowerCase());
  return match ?? trimmed;
}

const DISCIPLINE_ABBREV: Record<string, string> = {
  Nursing: 'NS',
  'Personal Support': 'PSW',
  'Occupational Therapy': 'OT',
  'Speech-Language Pathology': 'SLP',
  'Rehab Assistant': 'RA',
  Physiotherapy: 'PT',
  'Social Work': 'SW',
};

function formatDiscipline(discipline: string | null): string {
  if (!discipline?.trim()) return '—';
  const normalized = normalizeDiscipline(discipline);
  return DISCIPLINE_ABBREV[normalized] ?? normalized;
}

const VISIT_TYPE_PREFIX = /^UHN AT HOME\s+/i;

function formatVisitType(visitType: string | null | undefined): string {
  if (!visitType?.trim()) return '—';
  const stripped = visitType.trim().replace(VISIT_TYPE_PREFIX, '').trim();
  return stripped || '—';
}

function formatDeliveryMode(visitType: string | null | undefined): string {
  const normalized = (visitType ?? '').toUpperCase();
  if (normalized.includes('MSTEAMS')) return 'VIRTUAL';
  if (normalized.includes('PHONE')) return 'PHONE';
  return 'IN-PERSON';
}

function formatBillable(v: ServiceVisit): string {
  return v.is_billable ? 'Yes' : 'No';
}

function formatPayable(v: ServiceVisit, outcome?: InvestigationOutcome | null): string {
  if (outcome === 'payable') return 'Yes';
  if (outcome === 'not_payable') return 'No';
  if (v.needs_cancellation_investigation) return 'Pending';
  return 'Yes';
}

function VisitGridRow({
  visit,
  isEditing,
  canEdit,
  onStartEdit,
  onCancelEdit,
  onSaveRow,
}: {
  visit: ServiceVisitRow;
  isEditing: boolean;
  canEdit: boolean;
  onStartEdit: (visit: ServiceVisit) => void;
  onCancelEdit: () => void;
  onSaveRow: (visitId: string, updates: Partial<ServiceVisit>) => Promise<void>;
}) {
  const [draft, setDraft] = useState<VisitDraft>(() => visitToDraft(visit));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isEditing) setDraft(visitToDraft(visit));
  }, [isEditing, visit]);

  const handleSave = async () => {
    const updates = draftToUpdates(draft, visit);
    if (Object.keys(updates).length === 0) {
      onCancelEdit();
      return;
    }
    setSaving(true);
    try {
      await onSaveRow(visit.id, updates);
    } finally {
      setSaving(false);
    }
  };

  const setField = (field: EditableField, value: string) => {
    setDraft((d) => ({ ...d, [field]: value }));
  };

  const inputCell = (field: EditableField) => (
    <input
      className="hc-cell-input"
      value={draft[field]}
      onChange={(e) => setField(field, e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          void handleSave();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          onCancelEdit();
        }
      }}
      disabled={saving}
    />
  );

  const disciplineSelectCell = () => {
    const normalized = normalizeDiscipline(draft.employee_discipline);
    const options =
      normalized && !DISCIPLINE_OPTIONS.includes(normalized as (typeof DISCIPLINE_OPTIONS)[number])
        ? [normalized, ...DISCIPLINE_OPTIONS]
        : DISCIPLINE_OPTIONS;

    return (
      <select
        className="hc-cell-input hc-cell-select"
        value={normalized}
        onChange={(e) => setField('employee_discipline', e.target.value)}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void handleSave();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onCancelEdit();
          }
        }}
        disabled={saving}
      >
        <option value="">—</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    );
  };

  if (isEditing) {
    return (
      <tr className="hc-row--editing">
        <td>{visit.import_row_number}</td>
        <td>{cell(visit.mrn)}</td>
        <td className="hc-col-care-stream">{inputCell('care_stream')}</td>
        <td>{cell(visit.service_date)}</td>
        <td>{cell(visit.service_time)}</td>
        <td>{inputCell('duration_minutes')}</td>
        <td>{formatEmployeeName(visit.employee_last, visit.employee_first)}</td>
        <td>{cell(visit.employee_id)}</td>
        <td>{disciplineSelectCell()}</td>
        <td>{formatDeliveryMode(draft.visit_type)}</td>
        <td>{inputCell('visit_type')}</td>
        <td>{inputCell('status_of_visit')}</td>
        <td>{cell(visit.visit_cancel_reason)}</td>
        <td>{formatBillable(visit)}</td>
        <td>{formatPayable(visit, visit.investigation?.outcome)}</td>
      </tr>
    );
  }

  return (
    <tr
      className={canEdit ? 'hc-row--editable' : undefined}
      onClick={() => {
        if (canEdit) onStartEdit(visit);
      }}
    >
      <td>{visit.import_row_number}</td>
      <td>{cell(visit.mrn)}</td>
      <td className="hc-col-care-stream">{cell(visit.care_stream)}</td>
      <td>{cell(visit.service_date)}</td>
      <td>{cell(visit.service_time)}</td>
      <td>{cell(visit.duration_minutes)}</td>
      <td>{formatEmployeeName(visit.employee_last, visit.employee_first)}</td>
      <td>{cell(visit.employee_id)}</td>
      <td>{formatDiscipline(visit.employee_discipline)}</td>
      <td>{formatDeliveryMode(visit.visit_type)}</td>
      <td>{formatVisitType(visit.visit_type)}</td>
      <td>{cell(visit.status_of_visit)}</td>
      <td>{cell(visit.visit_cancel_reason)}</td>
      <td>{formatBillable(visit)}</td>
      <td>{formatPayable(visit, visit.investigation?.outcome)}</td>
    </tr>
  );
}

export function VisitGrid({
  visits,
  loading,
  canEdit,
  editingId,
  onStartEdit,
  onCancelEdit,
  onSaveRow,
}: VisitGridProps) {
  return (
    <div className="hc-grid-panel">
      {loading ? (
        <p className="hc-muted">Loading visits…</p>
      ) : (
        <>
          <div className="hc-table-wrap hc-table-wrap--scroll">
            <table className="hc-table hc-table--compact hc-table--visit-grid">
              <thead>
                <tr>
                  <th>#</th>
                  <th>MRN</th>
                  <th className="hc-col-care-stream">Care Stream</th>
                  <th>Service Date</th>
                  <th>Service Time</th>
                  <th>Service Duration</th>
                  <th>Employee Name</th>
                  <th>Employee ID</th>
                  <th>Discipline</th>
                  <th>Delivery Mode</th>
                  <th>Visit Type</th>
                  <th>Status</th>
                  <th>Visit Cancel Reason</th>
                  <th>Billable</th>
                  <th>Payable</th>
                </tr>
              </thead>
              <tbody>
                {visits.map((v) => (
                  <VisitGridRow
                    key={v.id}
                    visit={v}
                    isEditing={editingId === v.id}
                    canEdit={canEdit}
                    onStartEdit={onStartEdit}
                    onCancelEdit={onCancelEdit}
                    onSaveRow={onSaveRow}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

interface IssueDrawerProps {
  visit: ServiceVisit | null;
  issues: VisitIssue[];
  canEdit: boolean;
  isSpo: boolean;
  onClose: () => void;
  onSaveField: (field: keyof ServiceVisit, value: string) => Promise<void>;
  onApprove: (
    type: 'virtual_visit' | 'visit_limit_excess',
    status: 'approved' | 'denied',
    notes: string,
    extRef: string
  ) => Promise<void>;
  onInvestigate: (outcome: string, notes: string) => Promise<void>;
  auditContent: React.ReactNode;
  spoContent: React.ReactNode;
}

export function IssueDrawer({
  visit,
  issues,
  canEdit,
  isSpo,
  onClose,
  onSaveField,
  onApprove,
  onInvestigate,
  auditContent,
  spoContent,
}: IssueDrawerProps) {
  const [editField, setEditField] = useState<keyof ServiceVisit | null>(null);
  const [editValue, setEditValue] = useState('');
  const [approvalNotes, setApprovalNotes] = useState('');
  const [extRef, setExtRef] = useState('');
  const [invNotes, setInvNotes] = useState('');
  const [invOutcome, setInvOutcome] = useState('billable');

  if (!visit) return null;

  const editableFields: (keyof ServiceVisit)[] = [
    'employee_title',
    'employee_discipline',
    'duration_minutes',
    'status_of_visit',
    'visit_type',
    'care_stream',
  ];

  return (
    <aside className="hc-drawer">
      <div className="hc-drawer-header">
        <h2>
          Row {visit.import_row_number} · MRN {visit.mrn}
        </h2>
        <button type="button" className="hc-btn hc-btn-ghost" onClick={onClose}>
          Close
        </button>
      </div>

      {visit.billing_block_reason && (
        <p className="hc-block-reason">{visit.billing_block_reason}</p>
      )}

      <section className="hc-drawer-section">
        <h3>Issues ({issues.length})</h3>
        {issues.length === 0 ? (
          <p className="hc-muted">No open issues.</p>
        ) : (
          <ul className="hc-issue-list">
            {issues.map((i) => (
              <li key={i.id} className={`hc-issue hc-issue--${i.severity}`}>
                <strong>{i.issue_type}</strong>: {i.message}
              </li>
            ))}
          </ul>
        )}
      </section>

      {canEdit && (
        <section className="hc-drawer-section">
          <h3>Edit resolved fields</h3>
          <div className="hc-edit-grid">
            {editableFields.map((field) => (
              <div key={field} className="hc-edit-row">
                <label>{field}</label>
                {editField === field ? (
                  <div className="hc-edit-inline">
                    <input
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                    />
                    <button
                      type="button"
                      className="hc-btn hc-btn-primary"
                      onClick={async () => {
                        await onSaveField(field, editValue);
                        setEditField(null);
                      }}
                    >
                      Save
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="hc-link-btn"
                    onClick={() => {
                      setEditField(field);
                      setEditValue(String(visit[field] ?? ''));
                    }}
                  >
                    {String(visit[field] ?? '—')}
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {canEdit && visit.needs_virtual_approval && (
        <section className="hc-drawer-section">
          <h3>Virtual visit approval</h3>
          <textarea
            placeholder="Notes"
            value={approvalNotes}
            onChange={(e) => setApprovalNotes(e.target.value)}
            rows={2}
          />
          <input
            placeholder="External approval reference"
            value={extRef}
            onChange={(e) => setExtRef(e.target.value)}
          />
          <div className="hc-btn-row">
            <button
              type="button"
              className="hc-btn hc-btn-primary"
              onClick={() => onApprove('virtual_visit', 'approved', approvalNotes, extRef)}
            >
              Approve
            </button>
            <button
              type="button"
              className="hc-btn hc-btn-secondary"
              onClick={() => onApprove('virtual_visit', 'denied', approvalNotes, extRef)}
            >
              Deny
            </button>
          </div>
        </section>
      )}

      {canEdit && visit.needs_limit_approval && (
        <section className="hc-drawer-section">
          <h3>Visit limit excess approval</h3>
          <textarea
            placeholder="Notes"
            value={approvalNotes}
            onChange={(e) => setApprovalNotes(e.target.value)}
          />
          <button
            type="button"
            className="hc-btn hc-btn-primary"
            onClick={() => onApprove('visit_limit_excess', 'approved', approvalNotes, extRef)}
          >
            Approve excess visit
          </button>
        </section>
      )}

      {canEdit && visit.needs_cancellation_investigation && (
        <section className="hc-drawer-section">
          <h3>Cancellation investigation</h3>
          <select value={invOutcome} onChange={(e) => setInvOutcome(e.target.value)}>
            <option value="billable">Billable</option>
            <option value="not_billable">Not billable</option>
            <option value="payable">Payable</option>
            <option value="not_payable">Not payable</option>
          </select>
          <textarea
            placeholder="Investigation notes"
            value={invNotes}
            onChange={(e) => setInvNotes(e.target.value)}
            rows={3}
          />
          <button
            type="button"
            className="hc-btn hc-btn-primary"
            onClick={() => onInvestigate(invOutcome, invNotes)}
          >
            Save investigation
          </button>
        </section>
      )}

      <section className="hc-drawer-section">
        <h3>Audit trail</h3>
        {auditContent}
      </section>

      {(isSpo || canEdit) && (
        <section className="hc-drawer-section">
          <h3>SPO responses</h3>
          {spoContent}
        </section>
      )}
    </aside>
  );
}

export function AuditTimeline({
  events,
}: {
  events: { id: string; created_at: string; action: string; field_name: string | null; old_value: unknown; new_value: unknown }[];
}) {
  if (events.length === 0) return <p className="hc-muted">No audit events yet.</p>;
  return (
    <ul className="hc-audit-list">
      {events.map((e) => (
        <li key={e.id}>
          <time>{new Date(e.created_at).toLocaleString()}</time>
          <span>
            {e.action}
            {e.field_name ? ` · ${e.field_name}` : ''}
            {e.old_value != null || e.new_value != null
              ? `: ${JSON.stringify(e.old_value)} → ${JSON.stringify(e.new_value)}`
              : ''}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function SpoResponseThread({
  responses,
  canRespond,
  onSubmit,
}: {
  responses: { id: string; body: string; created_at: string; author_id: string }[];
  canRespond: boolean;
  onSubmit: (body: string) => Promise<void | { error: string | null }>;
}) {
  const [body, setBody] = useState('');

  return (
    <div>
      <ul className="hc-response-list">
        {responses.map((r) => (
          <li key={r.id}>
            <time>{new Date(r.created_at).toLocaleString()}</time>
            <p>{r.body}</p>
          </li>
        ))}
      </ul>
      {canRespond && (
        <div className="hc-response-form">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Add a response…"
            rows={2}
          />
          <button
            type="button"
            className="hc-btn hc-btn-primary"
            disabled={!body.trim()}
            onClick={async () => {
              await onSubmit(body);
              setBody('');
            }}
          >
            Post response
          </button>
        </div>
      )}
    </div>
  );
}
