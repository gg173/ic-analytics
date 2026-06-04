import { matchesMultiFilter } from '../components/ToolbarMultiSelect';
import type { EpicConversionRecord } from '../types';
import type { SsdbServiceDayRow } from './linkServiceDayCarePlans';

function getWeekStartIso(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  const daysFromMonday = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - daysFromMonday);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function buildRecordByEnrollId(
  records: EpicConversionRecord[]
): Map<string, EpicConversionRecord> {
  const recordByEnrollId = new Map<string, EpicConversionRecord>();
  for (const record of records) {
    if (!record.enroll_id || recordByEnrollId.has(record.enroll_id)) continue;
    recordByEnrollId.set(record.enroll_id, record);
  }
  return recordByEnrollId;
}

export function ssdbServiceRowMatchesPatientFilter(
  row: SsdbServiceDayRow,
  recordByEnrollId: Map<string, EpicConversionRecord>,
  search: string,
  icLeadFilter: readonly string[] | null,
  icLeadOptions: readonly string[]
): boolean {
  const enrollId = row.enroll_id?.trim();
  const record = enrollId ? recordByEnrollId.get(enrollId) : undefined;
  const icLead = record?.ic_lead ?? null;

  if (!matchesMultiFilter(icLeadFilter, icLead, icLeadOptions)) {
    return false;
  }

  const q = search.trim().toLowerCase();
  if (!q) return true;

  const mrn = (record?.mrn ?? row.mrn ?? '').toLowerCase();
  const pathway = (record?.pathway ?? row.pathway ?? '').toLowerCase();
  const gcn = record?.gcn?.toLowerCase() ?? '';
  const icLeadLower = icLead?.toLowerCase() ?? '';

  return (
    mrn.includes(q) ||
    gcn.includes(q) ||
    icLeadLower.includes(q) ||
    pathway.includes(q)
  );
}

export function aggregateSsdbServiceDayRows(rows: SsdbServiceDayRow[]): {
  serviceCountsByDate: Map<string, number>;
  patientCountsByDate: Map<string, number>;
  weekServiceCountsByWeekStart: Map<string, number>;
  weekPatientCountsByWeekStart: Map<string, number>;
  enrollIdsByDate: Map<string, Set<string>>;
  enrollIdsByWeekStart: Map<string, Set<string>>;
  ssdbPatientByDate: Map<string, Map<string, { mrn: string | null; pathway: string | null }>>;
  ssdbServiceRows: SsdbServiceDayRow[];
} {
  const serviceCountsByDate = new Map<string, number>();
  const ssdbServiceRows: SsdbServiceDayRow[] = [];
  const enrollIdsByDate = new Map<string, Set<string>>();
  const ssdbPatientByDate = new Map<
    string,
    Map<string, { mrn: string | null; pathway: string | null }>
  >();
  const calendarKeysByWeekStart = new Map<string, Set<string>>();
  const enrollIdsByWeekStart = new Map<string, Set<string>>();

  for (const row of rows) {
    if (!row.srv_date) continue;
    ssdbServiceRows.push(row);
    serviceCountsByDate.set(row.srv_date, (serviceCountsByDate.get(row.srv_date) ?? 0) + 1);
    if (row.enroll_id) {
      const enrollIds = enrollIdsByDate.get(row.srv_date) ?? new Set<string>();
      enrollIds.add(row.enroll_id);
      enrollIdsByDate.set(row.srv_date, enrollIds);

      const patientsOnDate = ssdbPatientByDate.get(row.srv_date) ?? new Map();
      if (!patientsOnDate.has(row.enroll_id)) {
        patientsOnDate.set(row.enroll_id, {
          mrn: row.mrn?.trim() || null,
          pathway: row.pathway?.trim() || null,
        });
      }
      ssdbPatientByDate.set(row.srv_date, patientsOnDate);
    }

    const weekStart = getWeekStartIso(row.srv_date);
    if (row.calendar_key) {
      const calendarKeys = calendarKeysByWeekStart.get(weekStart) ?? new Set<string>();
      calendarKeys.add(row.calendar_key);
      calendarKeysByWeekStart.set(weekStart, calendarKeys);
    }
    if (row.enroll_id) {
      const enrollIds = enrollIdsByWeekStart.get(weekStart) ?? new Set<string>();
      enrollIds.add(row.enroll_id);
      enrollIdsByWeekStart.set(weekStart, enrollIds);
    }
  }

  const patientCountsByDate = new Map<string, number>();
  for (const [date, enrollIds] of enrollIdsByDate) {
    patientCountsByDate.set(date, enrollIds.size);
  }

  const weekServiceCountsByWeekStart = new Map<string, number>();
  for (const [weekStart, calendarKeys] of calendarKeysByWeekStart) {
    weekServiceCountsByWeekStart.set(weekStart, calendarKeys.size);
  }

  const weekPatientCountsByWeekStart = new Map<string, number>();
  for (const [weekStart, enrollIds] of enrollIdsByWeekStart) {
    weekPatientCountsByWeekStart.set(weekStart, enrollIds.size);
  }

  return {
    serviceCountsByDate,
    patientCountsByDate,
    weekServiceCountsByWeekStart,
    weekPatientCountsByWeekStart,
    enrollIdsByDate,
    enrollIdsByWeekStart,
    ssdbPatientByDate,
    ssdbServiceRows,
  };
}

export function hasActiveServiceDayPatientFilter(
  search: string,
  icLeadFilter: readonly string[] | null
): boolean {
  return search.trim() !== '' || icLeadFilter !== null;
}
