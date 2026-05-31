import type { EpicConversionInsertRow } from '../types';
import {
  daysSinceLvdForImport,
  episodeConversionStrategy,
  latestSrvCategory,
  losCategoryFromDays,
  programLosDays,
} from './enrolmentRules';
import { parseDate, pick, str } from './mapEpicConversionRow';

function isIgnorableVhaRow(row: Record<string, unknown>): boolean {
  const enrollStatus = str(pick(row, ['ENROLL STATUS', 'Enroll Status']));
  const enrollId = str(pick(row, ['ENROLL ID', 'Enroll ID']));
  const mrn = str(pick(row, ['MRN', 'mrn']));

  if (enrollStatus?.startsWith('Applied filters')) return true;
  if (enrollStatus === 'Total') return true;
  if (!enrollId && !mrn) return true;
  if (enrollStatus !== 'ACTIVE') return true;
  if (!enrollId) return true;

  return false;
}

export function validateVhaSsdbHeaders(headers: string[]): string[] {
  const errors: string[] = [];
  const normalized = new Set(
    headers.map((h) => h.trim().toLowerCase().replace(/\s+/g, ' '))
  );
  if (!normalized.has('mrn')) errors.push('Missing required column: MRN');
  if (!normalized.has('enroll id')) errors.push('Missing required column: ENROLL ID');
  if (!normalized.has('hosp dc date') && !normalized.has('index date')) {
    errors.push('Missing required column: HOSP DC DATE or INDEX DATE');
  }
  return errors;
}

export function isVhaSsdbExport(headers: string[]): boolean {
  const normalized = new Set(
    headers.map((h) => h.trim().toLowerCase().replace(/\s+/g, ' '))
  );
  return normalized.has('enroll id') && normalized.has('enroll status');
}

export function mapVhaSsdbRow(
  row: Record<string, unknown>,
  sourceFilename: string,
  referenceDate: Date = new Date()
): EpicConversionInsertRow | null {
  if (isIgnorableVhaRow(row)) return null;

  const enrollId = str(pick(row, ['ENROLL ID', 'Enroll ID']));
  const mrn = str(pick(row, ['MRN', 'mrn']));
  if (!enrollId || !mrn) return null;

  const hospDcDate =
    parseDate(pick(row, ['HOSP DC DATE', 'Hosp DC Date'])) ??
    parseDate(pick(row, ['INDEX DATE', 'Index Date']));
  const lvdIso = parseDate(pick(row, ['LVD', 'lvd']));

  const losDays = programLosDays(hospDcDate, referenceDate);
  const losCategory = losCategoryFromDays(losDays);
  const latestSrv = latestSrvCategory(lvdIso, referenceDate);
  const strategy = episodeConversionStrategy(losCategory, latestSrv);

  return {
    enroll_id: enrollId,
    gcn: str(pick(row, ['GCN', 'gcn'])),
    mrn,
    pathway: str(pick(row, ['PATHWAY', 'pathway'])),
    care_path: str(pick(row, ['CARE PATH', 'Care Path', 'care path'])),
    support_tier: str(pick(row, ['SUPPORT TIER', 'Support Tier'])),
    ic_lead: str(pick(row, ['IC LEAD', 'IC Lead'])),
    registration_date: parseDate(pick(row, ['REGISTRATION DATE', 'Registration Date'])),
    hosp_dc_date: hospDcDate,
    episode_conversion_strategy: strategy,
    los: losDays != null ? String(losDays) : null,
    los_category: losCategory,
    latest_srv: latestSrv,
    days_since_lvd: daysSinceLvdForImport(lvdIso, referenceDate),
    lvd: lvdIso,
    lvt: str(pick(row, ['LVT', 'lvt'])),
    source_filename: sourceFilename,
  };
}

export function mapVhaSsdbRows(
  rows: Record<string, unknown>[],
  sourceFilename: string,
  referenceDate: Date = new Date()
): { rows: EpicConversionInsertRow[]; skipped: number } {
  let skipped = 0;
  const mapped: EpicConversionInsertRow[] = [];
  const seenEnrollIds = new Set<string>();

  for (const row of rows) {
    const mappedRow = mapVhaSsdbRow(row, sourceFilename, referenceDate);
    if (!mappedRow) {
      skipped += 1;
      continue;
    }
    if (seenEnrollIds.has(mappedRow.enroll_id!)) {
      skipped += 1;
      continue;
    }
    seenEnrollIds.add(mappedRow.enroll_id!);
    mapped.push(mappedRow);
  }

  return { rows: mapped, skipped };
}
