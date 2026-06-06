import {
  buildHandledMrnSet,
  DISCHARGE_STRATEGY,
  isIclDecisionRequiredRecord,
  recordBelongsToStrategyTab,
} from '../progress/recordStrategyTabs';
import { normalizeMrnForMatch } from '../reconciliation/reconcileReportRows';
import type { EpicConversionRecord } from '../types';
import { carePlanRowFingerprint } from './carePlanDedup';
import { classifyClientNeedsGoals } from './classifyCarePlanContent';
import type {
  CarePlanEligibilityReason,
  CarePlanLinkSummary,
  CarePlanPatientLink,
  EpicCarePlanRow,
  LinkedCarePlanRow,
} from './types';
import { buildEmarRowIndex, matchEmarRowsForRecord } from '../emar/linkEmar';
import type { EpicEmarRow } from '../emar/types';

export function mapCarePlanRowToLinked(
  row: EpicCarePlanRow,
  sourceFilenameByImportId: Map<string, string>
): LinkedCarePlanRow {
  return {
    id: row.id,
    importId: row.import_id,
    sourceFilename: sourceFilenameByImportId.get(row.import_id) ?? '—',
    brn: row.brn,
    clientId: row.client_id,
    offerId: row.offer_id,
    goldcareId: row.goldcare_id,
    patientName: row.patient_name,
    clientNeedsGoals: row.client_needs_goals,
    clientNeedsKind: classifyClientNeedsGoals(row.client_needs_goals),
    serviceTeachingPlan: row.service_teaching_plan,
    outcomes: row.outcomes,
    goalMet: row.goal_met,
    dateSaved: row.date_saved,
    rowIndex: row.row_index,
  };
}

export function normalizeGcnForMatch(gcn: string): string {
  const digits = gcn.trim().replace(/\D/g, '');
  if (!digits) return gcn.trim().toLowerCase();
  return digits.replace(/^0+/, '') || '0';
}

export function isInCarePlanAnalysisScope(record: EpicConversionRecord): boolean {
  if (record.status === 'discharged') return false;
  if (recordBelongsToStrategyTab(record, DISCHARGE_STRATEGY)) return false;
  return true;
}

export function isEligibleForCarePlanLinking(
  record: EpicConversionRecord,
  validatedRecordIds: ReadonlySet<string>,
  handledMrns?: ReadonlySet<string>
): CarePlanEligibilityReason[] {
  if (record.status === 'discharged') return [];

  const reasons: CarePlanEligibilityReason[] = [];

  if (isIclDecisionRequiredRecord(record, handledMrns)) {
    reasons.push('icl_pending');
  }

  if (record.completed_at) {
    reasons.push('converted');
  }

  if (validatedRecordIds.has(record.id)) {
    reasons.push('validated');
  }

  return reasons;
}

function indexCarePlanRows(
  carePlanRows: EpicCarePlanRow[],
  sourceFilenameByImportId: Map<string, string>
): {
  byBrn: Map<string, LinkedCarePlanRow[]>;
  byGcn: Map<string, LinkedCarePlanRow[]>;
} {
  const byBrn = new Map<string, LinkedCarePlanRow[]>();
  const byGcn = new Map<string, LinkedCarePlanRow[]>();

  for (const row of carePlanRows) {
    const linked = mapCarePlanRowToLinked(row, sourceFilenameByImportId);
    const brnKey = normalizeMrnForMatch(row.brn);
    if (brnKey) {
      const list = byBrn.get(brnKey) ?? [];
      list.push(linked);
      byBrn.set(brnKey, list);
    }
    if (row.goldcare_id?.trim()) {
      const gcnKey = normalizeGcnForMatch(row.goldcare_id);
      const list = byGcn.get(gcnKey) ?? [];
      list.push(linked);
      byGcn.set(gcnKey, list);
    }
  }

  return { byBrn, byGcn };
}

function linkedCarePlanFingerprint(row: LinkedCarePlanRow): string {
  return carePlanRowFingerprint({
    brn: row.brn,
    client_id: row.clientId,
    offer_id: row.offerId,
    goldcare_id: row.goldcareId,
    patient_name: row.patientName,
    client_needs_goals: row.clientNeedsGoals,
    service_teaching_plan: row.serviceTeachingPlan,
    outcomes: row.outcomes,
    goal_met: row.goalMet,
    date_saved: row.dateSaved,
  });
}

function dedupeLinkedCarePlanRows(rows: LinkedCarePlanRow[]): LinkedCarePlanRow[] {
  const bestByFingerprint = new Map<string, LinkedCarePlanRow>();
  for (const row of rows) {
    const fingerprint = linkedCarePlanFingerprint(row);
    const existing = bestByFingerprint.get(fingerprint);
    if (!existing) {
      bestByFingerprint.set(fingerprint, row);
      continue;
    }
    const rowDate = row.dateSaved ?? '';
    const existingDate = existing.dateSaved ?? '';
    if (rowDate > existingDate || (rowDate === existingDate && row.rowIndex >= existing.rowIndex)) {
      bestByFingerprint.set(fingerprint, row);
    }
  }
  return [...bestByFingerprint.values()];
}

function matchCarePlanRowsForRecord(
  record: EpicConversionRecord,
  byBrn: Map<string, LinkedCarePlanRow[]>,
  byGcn: Map<string, LinkedCarePlanRow[]>
): LinkedCarePlanRow[] {
  const matched = new Map<string, LinkedCarePlanRow>();

  const mrnKey = normalizeMrnForMatch(record.mrn);
  for (const row of byBrn.get(mrnKey) ?? []) {
    matched.set(row.id, row);
  }

  if (record.gcn?.trim()) {
    const gcnKey = normalizeGcnForMatch(record.gcn);
    for (const row of byGcn.get(gcnKey) ?? []) {
      matched.set(row.id, row);
    }
  }

  const deduped = dedupeLinkedCarePlanRows([...matched.values()]);
  return deduped.sort((a, b) => {
    const fileCmp = a.sourceFilename.localeCompare(b.sourceFilename);
    if (fileCmp !== 0) return fileCmp;
    return a.rowIndex - b.rowIndex;
  });
}

export function buildCarePlanPatientLinks(
  records: EpicConversionRecord[],
  carePlanRows: EpicCarePlanRow[],
  validatedRecordIds: ReadonlySet<string>,
  sourceFilenameByImportId: Map<string, string>,
  emarRows: EpicEmarRow[] = [],
  emarSourceFilenameByImportId: Map<string, string> = new Map()
): CarePlanPatientLink[] {
  const { byBrn, byGcn } = indexCarePlanRows(carePlanRows, sourceFilenameByImportId);
  const emarIndex = buildEmarRowIndex(emarRows, emarSourceFilenameByImportId);
  const handledMrns = buildHandledMrnSet(records);
  const links: CarePlanPatientLink[] = [];

  for (const record of records) {
    if (!isInCarePlanAnalysisScope(record)) continue;

    const eligibilityReasons = isEligibleForCarePlanLinking(
      record,
      validatedRecordIds,
      handledMrns
    );

    links.push({
      recordId: record.id,
      enrollId: record.enroll_id,
      mrn: record.mrn,
      gcn: record.gcn,
      pathway: record.pathway,
      carePath: record.care_path,
      icLead: record.ic_lead,
      hospDcDate: record.hosp_dc_date,
      lvd: record.lvd,
      eligibilityReasons,
      carePlanCompletedBy: record.care_plan_completed_by,
      carePlanCompletedAt: record.care_plan_completed_at,
      emarCompletedBy: record.emar_completed_by,
      emarCompletedAt: record.emar_completed_at,
      carePlanRows: matchCarePlanRowsForRecord(record, byBrn, byGcn),
      emarRows: matchEmarRowsForRecord(
        record,
        emarIndex.byRecordId,
        emarIndex.byBrn,
        emarIndex.byGcn
      ),
    });
  }

  links.sort((a, b) => a.mrn.localeCompare(b.mrn));
  return links;
}

function carePlanRowSortTime(row: LinkedCarePlanRow): number {
  if (!row.dateSaved) return 0;
  return parseLvdMs(row.dateSaved) ?? 0;
}

/** Most recent first; ties broken by source file then row index (newer import rows later). */
export function sortCarePlanRowsChronological(
  rows: LinkedCarePlanRow[]
): LinkedCarePlanRow[] {
  return [...rows].sort((a, b) => {
    const dateDiff = carePlanRowSortTime(b) - carePlanRowSortTime(a);
    if (dateDiff !== 0) return dateDiff;
    const fileCmp = b.sourceFilename.localeCompare(a.sourceFilename);
    if (fileCmp !== 0) return fileCmp;
    return b.rowIndex - a.rowIndex;
  });
}

export function recordHasTemplatedCarePlan(link: CarePlanPatientLink): boolean {
  return link.carePlanRows.some((row) => row.clientNeedsKind === 'templated');
}

export function getLatestCarePlanRow(link: CarePlanPatientLink): LinkedCarePlanRow | null {
  if (link.carePlanRows.length === 0) return null;
  return sortCarePlanRowsChronological(link.carePlanRows)[0];
}

/** 19 May 2026 (calendar). Latest care plan before this date needs an update. */
export const CARE_PLAN_UPDATE_REQUIRED_BEFORE_MS = Date.parse('2026-05-19T12:00:00');

export interface CarePlanDateRange {
  from: string;
  to: string;
}

/** Default end date for the care plan conversion visit date filter. */
export const CARE_PLAN_DEFAULT_VISIT_TO_DATE = '2026-07-05';

export function buildDefaultCarePlanVisitDateRange(dataMinDate: string): CarePlanDateRange {
  return {
    from: dataMinDate,
    to: CARE_PLAN_DEFAULT_VISIT_TO_DATE,
  };
}

/** @deprecated Use CarePlanDateRange */
export type CarePlanLvdDateRange = CarePlanDateRange;

export function parseLvdMs(lvd: string | null | undefined): number | null {
  if (!lvd?.trim()) return null;
  const parsed = Date.parse(`${lvd.trim()}T12:00:00`);
  return Number.isNaN(parsed) ? null : parsed;
}

/** Display ISO date input value (YYYY-MM-DD) as DD MMM YYYY. */
export function formatIsoDateInputDisplay(isoDate: string): string {
  if (!isoDate) return '';
  const d = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  const day = String(d.getDate()).padStart(2, '0');
  const month = d.toLocaleDateString('en-US', { month: 'short' });
  return `${day} ${month} ${d.getFullYear()}`;
}

export function visitDateRangeIsActive(range: CarePlanDateRange): boolean {
  return Boolean(range.from || range.to);
}

export function carePlanDateRangesEqual(a: CarePlanDateRange, b: CarePlanDateRange): boolean {
  return a.from === b.from && a.to === b.to;
}

export function getPatientVisitCountInRange(
  enrollId: string | null | undefined,
  visitCountsByEnrollId: ReadonlyMap<string, number> | null
): number | null {
  if (visitCountsByEnrollId === null) return null;
  const key = enrollId?.trim();
  if (!key) return null;
  return visitCountsByEnrollId.get(key) ?? 0;
}

/** True when the patient has at least one SSDB service visit in the toolbar date range. */
export function patientHasSsdbVisitInToolbarDateRange(
  enrollId: string | null | undefined,
  visitCountsByEnrollId: ReadonlyMap<string, number> | null,
  range: CarePlanDateRange
): boolean {
  if (!visitDateRangeIsActive(range)) return true;
  if (visitCountsByEnrollId === null) return true;
  const count = getPatientVisitCountInRange(enrollId, visitCountsByEnrollId);
  return count != null && count > 0;
}

export function isCarePlanDateStale(dateSaved: string | null | undefined): boolean {
  const parsed = parseLvdMs(dateSaved);
  if (parsed == null) return false;
  return parsed < CARE_PLAN_UPDATE_REQUIRED_BEFORE_MS;
}

export function patientNeedsCarePlanUpdate(link: CarePlanPatientLink): boolean {
  const latest = getLatestCarePlanRow(link);
  if (!latest) return false;

  const latestMs = carePlanRowSortTime(latest);
  if (latestMs === 0) return true;

  return latestMs < CARE_PLAN_UPDATE_REQUIRED_BEFORE_MS;
}

/** True when the patient still has no linked care plan data. */
export function patientHasNoCarePlanData(link: CarePlanPatientLink): boolean {
  return link.carePlanRows.length === 0;
}

/** True when linked care plans exist but none use the conversion template. */
export function patientHasOnlyUnstructuredCarePlan(link: CarePlanPatientLink): boolean {
  return link.carePlanRows.length > 0 && !recordHasTemplatedCarePlan(link);
}

/** True when the patient has linked eMAR rows requiring conversion. */
export function patientHasEmarConversion(link: CarePlanPatientLink): boolean {
  return link.emarRows.length > 0;
}

/**
 * A row moves to the completed table when care plan conversion is marked done.
 * If the patient also has eMAR conversion, both care plan and eMAR must be marked done.
 */
export function isCarePlanConversionRowComplete(link: CarePlanPatientLink): boolean {
  if (!link.carePlanCompletedAt) return false;
  if (!patientHasEmarConversion(link)) return true;
  return !!link.emarCompletedAt;
}

/**
 * After a new EMRI upload, completed conversions in these categories should return
 * to pending so staff can confirm the status against fresh data.
 */
export function patientNeedsCarePlanStatusRecheck(link: CarePlanPatientLink): boolean {
  return (
    patientHasNoCarePlanData(link) ||
    patientHasOnlyUnstructuredCarePlan(link) ||
    patientNeedsCarePlanUpdate(link)
  );
}

export function findCompletedRecordIdsNeedingCarePlanRecheck(
  links: CarePlanPatientLink[]
): string[] {
  return links
    .filter((link) => link.carePlanCompletedAt && patientNeedsCarePlanStatusRecheck(link))
    .map((link) => link.recordId);
}

export interface CarePlanProgressMetrics {
  total: number;
  linkedComplete: number;
  conversionComplete: number;
  percentLinked: number;
  percentConversionCompleteOfLinked: number;
}

export function computeCarePlanProgressMetrics(
  links: CarePlanPatientLink[]
): CarePlanProgressMetrics {
  const total = links.length;
  let linkedComplete = 0;
  let conversionComplete = 0;

  for (const link of links) {
    if (recordHasTemplatedCarePlan(link)) linkedComplete += 1;
    if (isCarePlanConversionRowComplete(link)) conversionComplete += 1;
  }

  return {
    total,
    linkedComplete,
    conversionComplete,
    percentLinked: total > 0 ? Math.round((linkedComplete / total) * 100) : 0,
    percentConversionCompleteOfLinked:
      linkedComplete > 0 ? Math.round((conversionComplete / linkedComplete) * 100) : 0,
  };
}

export function summarizeCarePlanLinks(links: CarePlanPatientLink[]): CarePlanLinkSummary {
  let withCarePlanCount = 0;
  let withTemplatedRecordCount = 0;
  let onlyUnstructuredRecordCount = 0;
  let carePlanUpdateRequiredCount = 0;

  for (const link of links) {
    if (link.carePlanRows.length === 0) continue;

    withCarePlanCount += 1;

    if (recordHasTemplatedCarePlan(link)) {
      withTemplatedRecordCount += 1;
    } else {
      onlyUnstructuredRecordCount += 1;
    }

    if (patientNeedsCarePlanUpdate(link)) {
      carePlanUpdateRequiredCount += 1;
    }
  }

  return {
    totalRecordCount: links.length,
    withCarePlanCount,
    withoutCarePlanCount: links.length - withCarePlanCount,
    withTemplatedRecordCount,
    onlyUnstructuredRecordCount,
    carePlanUpdateRequiredCount,
  };
}

export function eligibilityReasonLabel(reason: CarePlanEligibilityReason): string {
  switch (reason) {
    case 'converted':
      return 'Converted';
    case 'validated':
      return 'Conversion validated';
    case 'icl_pending':
      return 'ICL decision required';
  }
}
