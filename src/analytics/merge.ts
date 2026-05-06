import { normalizePatientId } from '../identity/patientId';
import type { LinkageMismatchLists, MergedClinicalRow } from '../data/types';
import { parseExcelDate } from './dates';

const VHA_KEYS = {
  mrn: ['MRN'],
  carePath: ['CARE PATH', 'CAREPATH'],
  /** When present, used for monthly cohort (enrolment month). Falls back to HOSP DC. */
  enrollDate: [
    'ENROLL DATE',
    'ENROLMENT DATE',
    'ENROLLMENT DATE',
    'VHA ENROLL DATE',
    'DATE ENROLLED',
    'ENROLLED DATE',
  ],
  hospDc: [
    'HOSP DC DATE',
    'HOSPITAL DC DATE',
    'HOSPITAL DISCHARGE DATE',
    'HOSP DC',
    'DC DATE',
  ],
  contact: ['CONTACT IN 24H', 'CONTACT WITHIN 24H?'],
  weekend: ['WEEKEND DC', 'WEEKEND DC?'],
  supportLine: ['# Support Line Calls', 'SUPPORT LINE CALLS'],
  iclPdd: ['# ICL Call (PDD)', 'PDD CALL (ICL)'],
  iclAddl: ['# ICL Call (ADDL)', 'ADDL ICL CALL'],
  vhaCall: ['# VHA Call'],
  enroll: ['ENROLL STATUS'],
} as const;

const FS_KEYS = {
  mrn: ['MRN'],
  hospDc: ['Hospital Discharge Date', 'Hospital_Discharge_Date'],
  site: ['Hospital Site'],
  patientStatus: ['Patient Status', 'PATIENT STATUS', 'Patient_Status'],
  eligibility: ['Eligibility', 'ELIGIBILITY'],
} as const;

/** Flowsheet rows with this status are excluded from linkage and indexing. */
const READMIT_PATIENT_STATUS_LC = 're-admit patient';

/** Only Flowsheet rows with this eligibility participate in linkage. */
const ENROLLED_ELIGIBILITY_LC = 'enrolled';

function pick(row: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const k of keys) {
    if (k in row && row[k] !== undefined && row[k] !== '') return row[k];
  }
  return undefined;
}

function num(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function yesNo(v: unknown): boolean | null {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).trim().toLowerCase();
  if (s === 'yes' || s === 'y') return true;
  if (s === 'no' || s === 'n') return false;
  return null;
}

export interface FlowsheetIndexed {
  byPatient: Map<string, Record<string, unknown>[]>;
}

function normalizeStatusToken(v: unknown): string {
  return String(v ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function isReadmitPatientFlowsheetRow(row: Record<string, unknown>): boolean {
  const raw = pick(row, FS_KEYS.patientStatus);
  return normalizeStatusToken(raw) === READMIT_PATIENT_STATUS_LC;
}

function hasFlowsheetHospitalDischargeDate(row: Record<string, unknown>): boolean {
  return parseExcelDate(pick(row, FS_KEYS.hospDc)) !== null;
}

function isFlowsheetEligibilityEnrolled(row: Record<string, unknown>): boolean {
  const raw = pick(row, FS_KEYS.eligibility);
  return normalizeStatusToken(raw) === ENROLLED_ELIGIBILITY_LC;
}

/**
 * PMCC and Toronto Rehab locations are rolled into Toronto General for site grouping (TG).
 */
export function recodeHospitalSiteString(raw: string): string {
  const t = raw.trim();
  if (!t) return t;
  const lc = t.toLowerCase();
  if (lc === 'princess margaret cancer centre') {
    return 'Toronto General Hospital';
  }
  if (lc.startsWith('toronto rehab')) {
    return 'Toronto General Hospital';
  }
  return t;
}

/** Drops Flowsheet rows that should not participate in linkage (eligibility, re-admits, blank DC). */
export function filterFlowsheetRows(
  rows: Record<string, unknown>[]
): Record<string, unknown>[] {
  return rows.filter(
    (row) =>
      isFlowsheetEligibilityEnrolled(row) &&
      !isReadmitPatientFlowsheetRow(row) &&
      hasFlowsheetHospitalDischargeDate(row)
  );
}

export function indexFlowsheet(rows: Record<string, unknown>[]): FlowsheetIndexed {
  const byPatient = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const pk = normalizePatientId(pick(row, FS_KEYS.mrn));
    if (!pk) continue;
    const list = byPatient.get(pk) ?? [];
    list.push(row);
    byPatient.set(pk, list);
  }
  return { byPatient };
}

/** Prefer Flowsheet row with Hospital Discharge Date closest to VHA HOSP DC DATE. */
function pickFlowsheetRow(
  candidates: Record<string, unknown>[],
  vhaDc: Date | null
): { row: Record<string, unknown> | null; deltaDays: number | null } {
  if (!candidates.length) return { row: null, deltaDays: null };
  if (!vhaDc) return { row: candidates[0], deltaDays: null };
  let best = candidates[0];
  let bestAbs = Infinity;
  for (const c of candidates) {
    const fsDc = parseExcelDate(pick(c, FS_KEYS.hospDc));
    if (!fsDc) continue;
    const days = Math.round(
      (fsDc.getTime() - vhaDc.getTime()) / (24 * 3600 * 1000)
    );
    const a = Math.abs(days);
    if (a < bestAbs) {
      bestAbs = a;
      best = c;
    }
  }
  if (bestAbs === Infinity) return { row: candidates[0], deltaDays: null };
  const fsDc = parseExcelDate(pick(best, FS_KEYS.hospDc));
  const delta =
    fsDc && vhaDc
      ? Math.round((fsDc.getTime() - vhaDc.getTime()) / (24 * 3600 * 1000))
      : null;
  return { row: best, deltaDays: delta };
}

export function mergeVhaFlowsheet(
  vhaRows: Record<string, unknown>[],
  flowsheetByPatient: Map<string, Record<string, unknown>[]>
): MergedClinicalRow[] {
  const out: MergedClinicalRow[] = [];
  for (const row of vhaRows) {
    const patientKey = normalizePatientId(pick(row, VHA_KEYS.mrn));
    if (!patientKey) continue;

    const carePath = String(pick(row, VHA_KEYS.carePath) ?? '').trim();
    const enrollDate = parseExcelDate(pick(row, VHA_KEYS.enrollDate));
    const hospDcDate = parseExcelDate(pick(row, VHA_KEYS.hospDc));
    const monthSource = enrollDate ?? hospDcDate;
    const monthBucket = monthSource
      ? new Date(monthSource.getFullYear(), monthSource.getMonth(), 1)
      : null;

    const iclPdd = num(pick(row, VHA_KEYS.iclPdd));
    const iclAddl = num(pick(row, VHA_KEYS.iclAddl));
    const vhaCall = num(pick(row, VHA_KEYS.vhaCall));
    const scheduledCheckInCalls = iclPdd + iclAddl + vhaCall;

    const cands = flowsheetByPatient.get(patientKey) ?? [];
    const { row: fsRow, deltaDays } = pickFlowsheetRow(cands, hospDcDate);
    const siteRaw = fsRow ? pick(fsRow, FS_KEYS.site) : null;
    const hospitalSite =
      siteRaw === null || siteRaw === undefined
        ? null
        : recodeHospitalSiteString(String(siteRaw));

    out.push({
      patientKey,
      carePath,
      hospDcDate,
      monthBucket,
      contactIn24h: yesNo(pick(row, VHA_KEYS.contact)),
      weekendDc: yesNo(pick(row, VHA_KEYS.weekend)),
      supportLineCalls: num(pick(row, VHA_KEYS.supportLine)),
      scheduledCheckInCalls,
      enrollStatus: String(pick(row, VHA_KEYS.enroll) ?? '').trim(),
      hospitalSite: hospitalSite || null,
      flowsheetMatchDaysDelta: deltaDays,
    });
  }
  return out;
}

/**
 * True when VHA and Flowsheet agree on MRN and hospital discharge date (same calendar day).
 * Enrolment volumes use only these rows.
 */
export function isMrnHospDcDateMatch(r: MergedClinicalRow): boolean {
  return r.flowsheetMatchDaysDelta === 0;
}

/**
 * Rows that did not achieve same-calendar hospital DC linkage. Uses the same matching
 * rules as {@link mergeVhaFlowsheet}: `flowsheetRowsFiltered` must be the cohort
 * passed to {@link indexFlowsheet} (e.g. post–filter Flowsheet rows).
 */
export function partitionLinkageMismatchLists(
  vhaRows: Record<string, unknown>[],
  flowsheetRowsFiltered: Record<string, unknown>[],
  flowsheetByPatient: Map<string, Record<string, unknown>[]>
): LinkageMismatchLists {
  const vhaOnlyRows: Record<string, unknown>[] = [];
  const usedFlowsheetRows = new Set<Record<string, unknown>>();

  for (const row of vhaRows) {
    const patientKey = normalizePatientId(pick(row, VHA_KEYS.mrn));
    if (!patientKey) {
      vhaOnlyRows.push(row);
      continue;
    }

    const hospDcDate = parseExcelDate(pick(row, VHA_KEYS.hospDc));
    const cands = flowsheetByPatient.get(patientKey) ?? [];
    const { row: fsRow, deltaDays } = pickFlowsheetRow(cands, hospDcDate);

    if (deltaDays === 0 && fsRow) {
      usedFlowsheetRows.add(fsRow);
    } else {
      vhaOnlyRows.push(row);
    }
  }

  const flowsheetOnlyRows = flowsheetRowsFiltered.filter(
    (r) => !usedFlowsheetRows.has(r)
  );

  return { vhaOnlyRows, flowsheetOnlyRows };
}
