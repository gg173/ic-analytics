import { normalizePatientId } from '../../identity/patientId';
import type { MappedHomecareRow } from '../types';
import { HOMECARE_CSV_COLUMNS } from '../types';

function headerLookupKey(header: string): string {
  return header.trim().toLowerCase();
}

function pick(row: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const k of keys) {
    if (k in row && row[k] !== undefined && row[k] !== '') return row[k];
  }
  const byKey = new Map(
    Object.keys(row).map((key) => [headerLookupKey(key), key] as const)
  );
  for (const k of keys) {
    const actual = byKey.get(headerLookupKey(k));
    if (actual !== undefined) {
      const v = row[actual];
      if (v !== undefined && v !== '') return v;
    }
  }
  return undefined;
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s || null;
}

function parseDurationMinutes(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  const s = String(raw).trim();
  if (!s) return null;
  const hm = s.match(/^(\d+):(\d+)/);
  if (hm) return parseInt(hm[1], 10) * 60 + parseInt(hm[2], 10);
  const n = parseFloat(s.replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(year, month, 0).getDate();
}

function toIsoDateString(year: number, month: number, day: number): string | null {
  if (!isValidCalendarDate(year, month, day)) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Service dates in imports use dd/mm/yyyy (or dd-mm-yyyy). */
function parseServiceDate(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return raw.toISOString().slice(0, 10);
  }
  const s = String(raw).trim();
  if (!s) return null;

  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    return toIsoDateString(
      parseInt(iso[1], 10),
      parseInt(iso[2], 10),
      parseInt(iso[3], 10)
    );
  }

  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) {
    const day = parseInt(dmy[1], 10);
    const month = parseInt(dmy[2], 10);
    const year = parseInt(dmy[3], 10);
    return toIsoDateString(year, month, day);
  }

  return null;
}

export const COLUMN_ALIASES: Record<string, readonly string[]> = {
  mrn: ['MRN', 'mrn'],
  service_date: ['Service Date', 'service_date', 'ServiceDate'],
  service_time: ['Service Time', 'service_time'],
  duration: ['Service Duration', 'service_duration', 'Duration'],
  employee_first: ['Employee First', 'employee_first'],
  employee_last: ['Employee Last', 'employee_last'],
  employee_number: ['Employee #', 'Employee Number', 'employee_number'],
  employee_id: ['Employee ID', 'employee_id'],
  external_id: ['External ID', 'external_id'],
  employee_title: ['Employee Title', 'employee_title'],
  employee_discipline: ['Employee Discipline', 'employee_discipline'],
  status_of_visit: ['Status of Visit', 'status_of_visit', 'Status'],
  visit_type: ['Visit Type', 'visit_type'],
  visit_cancel_reason: ['Visit Cancel Reason', 'visit_cancel_reason'],
  visit_cancel_reason_description: ['Visit Cancel Reason Description', 'visit_cancel_reason_description'],
  program_code: ['Program Code', 'program_code'],
  bill_to_code: ['Bill To Code', 'bill_to_code'],
  travel_start_time: ['Travel Start Time', 'travel_start_time'],
  travel_end_time: ['Travel End Time', 'travel_end_time'],
  travel_duration: ['Travel Duration', 'travel_duration'],
  mileage: ['Mileage', 'mileage'],
  csn: ['CSN', 'csn'],
  care_stream: ['Care Stream', 'care_stream', 'CareStream'],
};

const HEADER_TO_CANONICAL = new Map<string, string>();
for (const col of HOMECARE_CSV_COLUMNS) {
  HEADER_TO_CANONICAL.set(headerLookupKey(col), col);
}
for (const aliases of Object.values(COLUMN_ALIASES)) {
  const canonical = aliases[0];
  for (const alias of aliases) {
    HEADER_TO_CANONICAL.set(headerLookupKey(alias), canonical);
  }
}

/** Map a file header to its canonical export name (case-insensitive), or null if unknown. */
export function canonicalizeHomecareHeader(header: string): string | null {
  return HEADER_TO_CANONICAL.get(headerLookupKey(header)) ?? null;
}

export function isKnownHomecareHeader(header: string): boolean {
  return canonicalizeHomecareHeader(header) != null;
}

/** True when the row looks like the service export header (MRN, Service Date, Service Duration). */
export function isHomecareHeaderRow(cells: string[]): boolean {
  const normalized = new Set(cells.map((c) => headerLookupKey(c)));
  const has = (aliases: readonly string[]) =>
    aliases.some((a) => normalized.has(headerLookupKey(a)));
  return (
    has(COLUMN_ALIASES.mrn) &&
    has(COLUMN_ALIASES.service_date) &&
    has(COLUMN_ALIASES.duration)
  );
}

export function mapHomecareRow(
  row: Record<string, unknown>,
  importRowNumber: number
): MappedHomecareRow {
  const raw_data = { ...row };
  const mileageRaw = pick(row, COLUMN_ALIASES.mileage);

  return {
    import_row_number: importRowNumber,
    raw_data,
    mrn: normalizePatientId(pick(row, COLUMN_ALIASES.mrn)),
    service_date: parseServiceDate(pick(row, COLUMN_ALIASES.service_date)),
    service_time: str(pick(row, COLUMN_ALIASES.service_time)),
    duration_minutes: parseDurationMinutes(pick(row, COLUMN_ALIASES.duration)),
    employee_first: str(pick(row, COLUMN_ALIASES.employee_first)),
    employee_last: str(pick(row, COLUMN_ALIASES.employee_last)),
    employee_number: str(pick(row, COLUMN_ALIASES.employee_number)),
    employee_id: str(pick(row, COLUMN_ALIASES.employee_id)),
    external_id: str(pick(row, COLUMN_ALIASES.external_id)),
    employee_title: str(pick(row, COLUMN_ALIASES.employee_title)),
    employee_discipline: str(pick(row, COLUMN_ALIASES.employee_discipline)),
    status_of_visit: str(pick(row, COLUMN_ALIASES.status_of_visit)),
    visit_type: str(pick(row, COLUMN_ALIASES.visit_type)),
    visit_cancel_reason: str(pick(row, COLUMN_ALIASES.visit_cancel_reason)),
    visit_cancel_reason_description: str(pick(row, COLUMN_ALIASES.visit_cancel_reason_description)),
    program_code: str(pick(row, COLUMN_ALIASES.program_code)),
    bill_to_code: str(pick(row, COLUMN_ALIASES.bill_to_code)),
    travel_start_time: str(pick(row, COLUMN_ALIASES.travel_start_time)),
    travel_end_time: str(pick(row, COLUMN_ALIASES.travel_end_time)),
    travel_duration: str(pick(row, COLUMN_ALIASES.travel_duration)),
    mileage: mileageRaw != null ? parseFloat(String(mileageRaw)) || null : null,
    csn: str(pick(row, COLUMN_ALIASES.csn)),
    care_stream: str(pick(row, COLUMN_ALIASES.care_stream)),
  };
}

export function mapHomecareRows(rows: Record<string, unknown>[]): MappedHomecareRow[] {
  return rows.map((row, i) => mapHomecareRow(row, i + 1));
}
