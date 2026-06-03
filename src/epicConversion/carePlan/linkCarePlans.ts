import {
  DISCHARGE_STRATEGY,
  ICL_REASSESSMENT_STRATEGY,
  recordBelongsToStrategyTab,
} from '../progress/recordStrategyTabs';
import { normalizeMrnForMatch } from '../reconciliation/reconcileReportRows';
import type { EpicConversionRecord } from '../types';
import { classifyClientNeedsGoals } from './classifyCarePlanContent';
import type {
  CarePlanEligibilityReason,
  CarePlanLinkSummary,
  CarePlanPatientLink,
  EpicCarePlanRow,
  LinkedCarePlanRow,
} from './types';

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
  validatedRecordIds: ReadonlySet<string>
): CarePlanEligibilityReason[] {
  if (record.status === 'discharged') return [];

  const reasons: CarePlanEligibilityReason[] = [];

  if (
    record.episode_conversion_strategy === ICL_REASSESSMENT_STRATEGY &&
    !record.icl_decision
  ) {
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

  return [...matched.values()].sort((a, b) => {
    const fileCmp = a.sourceFilename.localeCompare(b.sourceFilename);
    if (fileCmp !== 0) return fileCmp;
    return a.rowIndex - b.rowIndex;
  });
}

export function buildCarePlanPatientLinks(
  records: EpicConversionRecord[],
  carePlanRows: EpicCarePlanRow[],
  validatedRecordIds: ReadonlySet<string>,
  sourceFilenameByImportId: Map<string, string>
): CarePlanPatientLink[] {
  const { byBrn, byGcn } = indexCarePlanRows(carePlanRows, sourceFilenameByImportId);
  const links: CarePlanPatientLink[] = [];

  for (const record of records) {
    if (!isInCarePlanAnalysisScope(record)) continue;

    const eligibilityReasons = isEligibleForCarePlanLinking(record, validatedRecordIds);

    links.push({
      recordId: record.id,
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
      carePlanRows: matchCarePlanRowsForRecord(record, byBrn, byGcn),
    });
  }

  links.sort((a, b) => a.mrn.localeCompare(b.mrn));
  return links;
}

function carePlanRowSortTime(row: LinkedCarePlanRow): number {
  if (!row.dateSaved) return 0;
  const parsed = Date.parse(row.dateSaved);
  return Number.isNaN(parsed) ? 0 : parsed;
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

/** Start of 19 May 2026 (local). Latest care plan before this date needs an update. */
export const CARE_PLAN_UPDATE_REQUIRED_BEFORE_MS = new Date(2026, 4, 19).getTime();

export interface CarePlanLvdDateRange {
  from: string;
  to: string;
}

export function parseLvdMs(lvd: string | null | undefined): number | null {
  if (!lvd?.trim()) return null;
  const parsed = Date.parse(`${lvd.trim()}T12:00:00`);
  return Number.isNaN(parsed) ? null : parsed;
}

function formatMsForDateInput(ms: number): string {
  const d = new Date(ms);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
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

export function computeDefaultLvdDateRange(
  links: readonly Pick<CarePlanPatientLink, 'lvd'>[]
): CarePlanLvdDateRange {
  let minMs: number | null = null;
  let maxMs: number | null = null;

  for (const link of links) {
    const ms = parseLvdMs(link.lvd);
    if (ms == null) continue;
    if (minMs == null || ms < minMs) minMs = ms;
    if (maxMs == null || ms > maxMs) maxMs = ms;
  }

  if (minMs == null || maxMs == null) return { from: '', to: '' };

  return {
    from: formatMsForDateInput(minMs),
    to: formatMsForDateInput(maxMs),
  };
}

export function lvdMatchesToolbarDateRange(
  lvd: string | null | undefined,
  range: CarePlanLvdDateRange
): boolean {
  if (!range.from && !range.to) return true;

  const lvdMs = parseLvdMs(lvd);
  if (lvdMs == null) return false;

  if (range.from) {
    const fromMs = Date.parse(`${range.from}T12:00:00`);
    if (!Number.isNaN(fromMs) && lvdMs < fromMs) return false;
  }

  if (range.to) {
    const toMs = Date.parse(`${range.to}T12:00:00`);
    if (!Number.isNaN(toMs) && lvdMs > toMs) return false;
  }

  return true;
}

export function isCarePlanDateStale(dateSaved: string | null | undefined): boolean {
  if (!dateSaved?.trim()) return false;
  const parsed = Date.parse(dateSaved);
  if (Number.isNaN(parsed)) return false;
  return parsed < CARE_PLAN_UPDATE_REQUIRED_BEFORE_MS;
}

export function patientNeedsCarePlanUpdate(link: CarePlanPatientLink): boolean {
  const latest = getLatestCarePlanRow(link);
  if (!latest) return false;

  const latestMs = carePlanRowSortTime(latest);
  if (latestMs === 0) return true;

  return latestMs < CARE_PLAN_UPDATE_REQUIRED_BEFORE_MS;
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
    if (link.carePlanRows.length > 0) linkedComplete += 1;
    if (link.carePlanCompletedAt) conversionComplete += 1;
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
