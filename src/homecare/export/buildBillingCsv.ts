import type { ServiceVisit } from '../types';

const EXPORT_COLUMNS: { key: keyof ServiceVisit; header: string }[] = [
  { key: 'mrn', header: 'MRN' },
  { key: 'service_date', header: 'Service Date' },
  { key: 'service_time', header: 'Service Time' },
  { key: 'duration_minutes', header: 'Service Duration' },
  { key: 'employee_first', header: 'Employee First' },
  { key: 'employee_last', header: 'Employee Last' },
  { key: 'employee_number', header: 'Employee #' },
  { key: 'employee_id', header: 'Employee ID' },
  { key: 'external_id', header: 'External ID' },
  { key: 'employee_title', header: 'Employee Title' },
  { key: 'employee_discipline', header: 'Employee Discipline' },
  { key: 'status_of_visit', header: 'Status of Visit' },
  { key: 'visit_type', header: 'Visit Type' },
  { key: 'visit_cancel_reason', header: 'Visit Cancel Reason' },
  { key: 'visit_cancel_reason_description', header: 'Visit Cancel Reason Description' },
  { key: 'program_code', header: 'Program Code' },
  { key: 'bill_to_code', header: 'Bill To Code' },
  { key: 'travel_start_time', header: 'Travel Start Time' },
  { key: 'travel_end_time', header: 'Travel End Time' },
  { key: 'travel_duration', header: 'Travel Duration' },
  { key: 'mileage', header: 'Mileage' },
  { key: 'csn', header: 'CSN' },
  { key: 'care_stream', header: 'Care Stream' },
];

function escapeCsvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function buildBillingCsv(visits: ServiceVisit[], includeBlocked = false): string {
  const exportable = includeBlocked
    ? visits
    : visits.filter(
        (v) =>
          v.is_billable &&
          !v.needs_virtual_approval &&
          !v.needs_limit_approval &&
          !v.needs_cancellation_investigation
      );

  const headers = EXPORT_COLUMNS.map((c) => c.header);
  const lines = [headers.join(',')];

  for (const visit of exportable) {
    const cells = EXPORT_COLUMNS.map((c) => escapeCsvCell(visit[c.key]));
    lines.push(cells.join(','));
  }

  return lines.join('\n');
}

export function downloadBillingCsv(visits: ServiceVisit[], filename: string, includeBlocked = false): void {
  const csv = buildBillingCsv(visits, includeBlocked);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function buildAuditCsv(
  events: { created_at: string; action: string; field_name: string | null; old_value: unknown; new_value: unknown; actor_id: string | null }[]
): string {
  const headers = ['Timestamp', 'Action', 'Field', 'Old Value', 'New Value', 'Actor'];
  const lines = [headers.join(',')];
  for (const e of events) {
    lines.push(
      [
        e.created_at,
        e.action,
        e.field_name ?? '',
        escapeCsvCell(e.old_value),
        escapeCsvCell(e.new_value),
        e.actor_id ?? '',
      ].join(',')
    );
  }
  return lines.join('\n');
}
