import { classifyClientNeedsGoals } from '../carePlan/classifyCarePlanContent';
import { normalizeGcnForMatch } from '../carePlan/linkCarePlans';
import type { EpicCarePlanRow } from '../carePlan/types';
import { normalizeMrnForMatch } from '../reconciliation/reconcileReportRows';
import type { EpicConversionRecord } from '../types';
import type { EpicSsdbService, SsdbServiceIngestStatus } from './types';

function enrollIdHasTemplatedCarePlan(
  record: EpicConversionRecord,
  carePlanRowsByBrn: Map<string, EpicCarePlanRow[]>,
  carePlanRowsByGcn: Map<string, EpicCarePlanRow[]>
): boolean {
  const seen = new Set<string>();
  const mrnKey = normalizeMrnForMatch(record.mrn);
  for (const row of carePlanRowsByBrn.get(mrnKey) ?? []) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    if (classifyClientNeedsGoals(row.client_needs_goals) === 'templated') return true;
  }

  if (record.gcn?.trim()) {
    const gcnKey = normalizeGcnForMatch(record.gcn);
    for (const row of carePlanRowsByGcn.get(gcnKey) ?? []) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      if (classifyClientNeedsGoals(row.client_needs_goals) === 'templated') return true;
    }
  }

  return false;
}

function indexCarePlanRowsByPatientKeys(carePlanRows: EpicCarePlanRow[]): {
  byBrn: Map<string, EpicCarePlanRow[]>;
  byGcn: Map<string, EpicCarePlanRow[]>;
} {
  const byBrn = new Map<string, EpicCarePlanRow[]>();
  const byGcn = new Map<string, EpicCarePlanRow[]>();

  for (const row of carePlanRows) {
    const brnKey = normalizeMrnForMatch(row.brn);
    if (brnKey) {
      const list = byBrn.get(brnKey) ?? [];
      list.push(row);
      byBrn.set(brnKey, list);
    }
    if (row.goldcare_id?.trim()) {
      const gcnKey = normalizeGcnForMatch(row.goldcare_id);
      const list = byGcn.get(gcnKey) ?? [];
      list.push(row);
      byGcn.set(gcnKey, list);
    }
  }

  return { byBrn, byGcn };
}

/** For each key (service day or week start), templated care plan patient counts and shares. */
function computeTemplatedCarePlanStatsByEnrollIds(
  enrollIdsByKey: Map<string, Set<string>>,
  records: EpicConversionRecord[],
  carePlanRows: EpicCarePlanRow[]
): { countsByKey: Map<string, number>; percentsByKey: Map<string, number> } {
  const recordByEnrollId = new Map<string, EpicConversionRecord>();
  for (const record of records) {
    if (!record.enroll_id || recordByEnrollId.has(record.enroll_id)) continue;
    recordByEnrollId.set(record.enroll_id, record);
  }

  const { byBrn, byGcn } = indexCarePlanRowsByPatientKeys(carePlanRows);
  const countsByKey = new Map<string, number>();
  const percentsByKey = new Map<string, number>();

  for (const [key, enrollIds] of enrollIdsByKey) {
    if (enrollIds.size === 0) continue;

    let templatedCount = 0;
    for (const enrollId of enrollIds) {
      const record = recordByEnrollId.get(enrollId);
      if (!record) continue;
      if (enrollIdHasTemplatedCarePlan(record, byBrn, byGcn)) {
        templatedCount += 1;
      }
    }

    countsByKey.set(key, templatedCount);
    percentsByKey.set(key, Math.round((templatedCount / enrollIds.size) * 100));
  }

  return { countsByKey, percentsByKey };
}

/** For each service day, share of unique patients (by enroll_id) with a templated care plan. */
export function computeTemplatedCarePlanPercentByServiceDay(
  enrollIdsByDate: Map<string, Set<string>>,
  records: EpicConversionRecord[],
  carePlanRows: EpicCarePlanRow[]
): Map<string, number> {
  return computeTemplatedCarePlanStatsByEnrollIds(enrollIdsByDate, records, carePlanRows)
    .percentsByKey;
}

/** For each service day, count of unique patients with a templated care plan. */
export function computeTemplatedCarePlanCountByServiceDay(
  enrollIdsByDate: Map<string, Set<string>>,
  records: EpicConversionRecord[],
  carePlanRows: EpicCarePlanRow[]
): Map<string, number> {
  return computeTemplatedCarePlanStatsByEnrollIds(enrollIdsByDate, records, carePlanRows)
    .countsByKey;
}

/** For each week (Monday ISO start), share of unique patients with a templated care plan. */
export function computeTemplatedCarePlanPercentByServiceWeek(
  enrollIdsByWeekStart: Map<string, Set<string>>,
  records: EpicConversionRecord[],
  carePlanRows: EpicCarePlanRow[]
): Map<string, number> {
  return computeTemplatedCarePlanStatsByEnrollIds(enrollIdsByWeekStart, records, carePlanRows)
    .percentsByKey;
}

/** For each week (Monday ISO start), count of unique patients with a templated care plan. */
export function computeTemplatedCarePlanCountByServiceWeek(
  enrollIdsByWeekStart: Map<string, Set<string>>,
  records: EpicConversionRecord[],
  carePlanRows: EpicCarePlanRow[]
): Map<string, number> {
  return computeTemplatedCarePlanStatsByEnrollIds(enrollIdsByWeekStart, records, carePlanRows)
    .countsByKey;
}

export interface ServiceDayPatient {
  enrollId: string;
  mrn: string | null;
  pathway: string | null;
  icLead: string | null;
  hasTemplatedCarePlan: boolean;
}

export interface ServiceDayService {
  calendarKey: string;
  enrollId: string;
  mrn: string | null;
  srvDate: string;
  srvDiscipline: string | null;
  srvDeliveryMode: string | null;
  ingestStatus: SsdbServiceIngestStatus;
  hasTemplatedCarePlan: boolean;
}

export type SsdbServiceDayRow = Pick<
  EpicSsdbService,
  | 'calendar_key'
  | 'srv_date'
  | 'enroll_id'
  | 'mrn'
  | 'pathway'
  | 'srv_discipline'
  | 'srv_delivery_mode'
  | 'ingest_status'
>;

export type PatientSsdbServiceFetchRow = SsdbServiceDayRow &
  Pick<
    EpicSsdbService,
    | 'srv_date_pdd'
    | 'carepath'
    | 'program'
    | 'srv_code'
    | 'srv_code_description'
    | 'srv_status'
    | 'srv_tx_codes'
    | 'srv_provider_id'
    | 'srv_provider_designation'
    | 'start_time'
    | 'end_time'
    | 'worked_duration'
  >;

export interface PatientSsdbServiceDetail {
  calendarKey: string;
  srvDate: string;
  srvDatePdd: string | null;
  srvDiscipline: string | null;
  srvDeliveryMode: string | null;
  pathway: string | null;
  carepath: string | null;
  program: string | null;
  srvCode: string | null;
  srvCodeDescription: string | null;
  srvStatus: string | null;
  srvTxCodes: string | null;
  srvProviderId: string | null;
  srvProviderDesignation: string | null;
  startTime: string | null;
  endTime: string | null;
  workedDuration: string | null;
  ingestStatus: SsdbServiceIngestStatus;
}

export function mapPatientSsdbServiceDetail(row: PatientSsdbServiceFetchRow): PatientSsdbServiceDetail {
  return {
    calendarKey: row.calendar_key,
    srvDate: row.srv_date ?? '',
    srvDatePdd: row.srv_date_pdd?.trim() || null,
    srvDiscipline: row.srv_discipline?.trim() || null,
    srvDeliveryMode: row.srv_delivery_mode?.trim() || null,
    pathway: row.pathway?.trim() || null,
    carepath: row.carepath?.trim() || null,
    program: row.program?.trim() || null,
    srvCode: row.srv_code?.trim() || null,
    srvCodeDescription: row.srv_code_description?.trim() || null,
    srvStatus: row.srv_status?.trim() || null,
    srvTxCodes: row.srv_tx_codes?.trim() || null,
    srvProviderId: row.srv_provider_id?.trim() || null,
    srvProviderDesignation: row.srv_provider_designation?.trim() || null,
    startTime: row.start_time?.trim() || null,
    endTime: row.end_time?.trim() || null,
    workedDuration: row.worked_duration?.trim() || null,
    ingestStatus: row.ingest_status,
  };
}

export function indexPatientSsdbServiceDetails(
  rows: PatientSsdbServiceFetchRow[]
): Map<string, PatientSsdbServiceDetail> {
  const byCalendarKey = new Map<string, PatientSsdbServiceDetail>();
  for (const row of rows) {
    if (!row.calendar_key) continue;
    byCalendarKey.set(row.calendar_key, mapPatientSsdbServiceDetail(row));
  }
  return byCalendarKey;
}

export function formatSsdbServiceIngestStatusLabel(status: SsdbServiceIngestStatus): string {
  switch (status) {
    case 'changed':
      return 'Changed on re-import';
    case 'vha_cancelled':
      return 'Cancelled in VHA data';
    default:
      return 'Active';
  }
}

export function ssdbServiceRowHasChangeDetected(
  row: Pick<SsdbServiceDayRow, 'ingest_status'>
): boolean {
  return row.ingest_status === 'changed';
}

export function ssdbServiceRowHasCancellation(
  row: Pick<SsdbServiceDayRow, 'ingest_status'>
): boolean {
  return row.ingest_status === 'vha_cancelled';
}

const GENERAL_NURSING_CALL_LABEL = 'General Nursing Call';
const VHA_NURSING_CALL_LABEL = 'VHA Nursing Call';

/** SRV DISC label with delivery-mode suffix (IPV → Visit, CALL → Call when missing). */
export function formatServiceDaySrvDiscDisplay(
  discipline: string | null,
  deliveryMode: string | null
): string | null {
  const base = discipline?.trim();
  if (!base) return null;

  const deliv = deliveryMode?.trim().toUpperCase() ?? '';
  let label = base;
  if (deliv === 'IPV') {
    label = `${base} Visit`;
  } else if (deliv === 'CALL' && !/\bcall\b/i.test(base)) {
    label = `${base} Call`;
  }

  if (label === GENERAL_NURSING_CALL_LABEL) {
    return VHA_NURSING_CALL_LABEL;
  }
  return label;
}

function compareServiceDayPatients(a: ServiceDayPatient, b: ServiceDayPatient): number {
  const mrnCompare = (a.mrn ?? '').localeCompare(b.mrn ?? '', undefined, { sensitivity: 'base' });
  if (mrnCompare !== 0) return mrnCompare;
  return a.enrollId.localeCompare(b.enrollId);
}

/** Unique patients per service day with templated care plan status (when care plan data is linked). */
export function computeServiceDayPatientsByDate(
  enrollIdsByDate: Map<string, Set<string>>,
  ssdbPatientByDate: Map<string, Map<string, { mrn: string | null; pathway: string | null }>>,
  records: EpicConversionRecord[],
  carePlanRows: EpicCarePlanRow[],
  linkCarePlans: boolean
): Map<string, ServiceDayPatient[]> {
  const recordByEnrollId = new Map<string, EpicConversionRecord>();
  for (const record of records) {
    if (!record.enroll_id || recordByEnrollId.has(record.enroll_id)) continue;
    recordByEnrollId.set(record.enroll_id, record);
  }

  const { byBrn, byGcn } = indexCarePlanRowsByPatientKeys(carePlanRows);
  const patientsByDate = new Map<string, ServiceDayPatient[]>();

  for (const [date, enrollIds] of enrollIdsByDate) {
    const ssdbByEnrollId = ssdbPatientByDate.get(date) ?? new Map();
    const patients: ServiceDayPatient[] = [];
    for (const enrollId of enrollIds) {
      const record = recordByEnrollId.get(enrollId);
      const ssdb = ssdbByEnrollId.get(enrollId);
      patients.push({
        enrollId,
        mrn: ssdb?.mrn ?? null,
        pathway: ssdb?.pathway ?? null,
        icLead: record?.ic_lead?.trim() || null,
        hasTemplatedCarePlan:
          linkCarePlans && record != null
            ? enrollIdHasTemplatedCarePlan(record, byBrn, byGcn)
            : false,
      });
    }
    patients.sort(compareServiceDayPatients);
    patientsByDate.set(date, patients);
  }

  return patientsByDate;
}

function compareServiceDayServices(a: ServiceDayService, b: ServiceDayService): number {
  const dateCompare = a.srvDate.localeCompare(b.srvDate);
  if (dateCompare !== 0) return dateCompare;
  const mrnCompare = (a.mrn ?? '').localeCompare(b.mrn ?? '', undefined, { sensitivity: 'base' });
  if (mrnCompare !== 0) return mrnCompare;
  return a.calendarKey.localeCompare(b.calendarKey);
}

/** SSDB service rows with templated care plan status per enroll_id (when care plan data is linked). */
export function computeServiceDayServices(
  rows: SsdbServiceDayRow[],
  records: EpicConversionRecord[],
  carePlanRows: EpicCarePlanRow[],
  linkCarePlans: boolean
): ServiceDayService[] {
  const recordByEnrollId = new Map<string, EpicConversionRecord>();
  for (const record of records) {
    if (!record.enroll_id || recordByEnrollId.has(record.enroll_id)) continue;
    recordByEnrollId.set(record.enroll_id, record);
  }

  const { byBrn, byGcn } = indexCarePlanRowsByPatientKeys(carePlanRows);
  const services: ServiceDayService[] = [];

  for (const row of rows) {
    if (!row.srv_date || !row.calendar_key) continue;
    const enrollId = row.enroll_id?.trim();
    if (!enrollId) continue;
    const record = recordByEnrollId.get(enrollId);
    services.push({
      calendarKey: row.calendar_key,
      enrollId,
      mrn: row.mrn?.trim() || null,
      srvDate: row.srv_date,
      srvDiscipline: row.srv_discipline?.trim() || null,
      srvDeliveryMode: row.srv_delivery_mode?.trim() || null,
      ingestStatus: row.ingest_status,
      hasTemplatedCarePlan:
        linkCarePlans && record != null
          ? enrollIdHasTemplatedCarePlan(record, byBrn, byGcn)
          : false,
    });
  }

  services.sort(compareServiceDayServices);
  return services;
}
