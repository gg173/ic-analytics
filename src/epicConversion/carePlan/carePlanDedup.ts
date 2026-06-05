import { fetchAllSupabaseRows } from '../hooks/fetchAllSupabaseRows';
import { supabase } from '../../lib/supabase';
import { normalizeMrnForMatch } from '../reconciliation/reconcileReportRows';
import type { CarePlanInsertRow, EpicCarePlanRow } from './types';

/** Data columns compared for duplicate detection (excludes row_index and DB metadata). */
export const CARE_PLAN_DEDUP_FIELD_NAMES = [
  'brn',
  'client_id',
  'offer_id',
  'goldcare_id',
  'patient_name',
  'client_needs_goals',
  'service_teaching_plan',
  'outcomes',
  'goal_met',
  'date_saved',
] as const;

export type CarePlanDedupFields = (typeof CARE_PLAN_DEDUP_FIELD_NAMES)[number];

export type CarePlanDedupSnapshot = Pick<CarePlanInsertRow, CarePlanDedupFields>;

function normStr(value: string | null | undefined): string {
  return (value ?? '').trim();
}

/** Collapse Excel/export whitespace differences so visually identical rows match. */
export function normalizeCarePlanTextForDedup(value: string | null | undefined): string {
  return normStr(value)
    .replace(/\r\n/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ');
}

function normOptionalStr(value: string | null | undefined): string {
  return normalizeCarePlanTextForDedup(value);
}

function normBrn(value: string | null | undefined): string {
  const trimmed = normStr(value);
  if (!trimmed) return '';
  return normalizeMrnForMatch(trimmed);
}

function normDate(value: string | null | undefined): string {
  const trimmed = normStr(value);
  if (!trimmed) return '';
  const iso = trimmed.match(/^(\d{4}-\d{2}-\d{2})/)?.[1];
  return iso ?? trimmed;
}

/** Stable fingerprint across all care plan data columns. */
export function carePlanRowFingerprint(row: CarePlanDedupSnapshot): string {
  return CARE_PLAN_DEDUP_FIELD_NAMES.map((field) => {
    const value = row[field];
    if (field === 'date_saved') return normDate(value);
    if (field === 'brn') return normBrn(value);
    return normOptionalStr(value);
  }).join('\0');
}

function importTimestamp(
  importId: string,
  importImportedAtById?: ReadonlyMap<string, string>
): string {
  return importImportedAtById?.get(importId) ?? '';
}

function preferCarePlanRow(
  candidate: EpicCarePlanRow,
  incumbent: EpicCarePlanRow,
  importImportedAtById?: ReadonlyMap<string, string>
): boolean {
  const candidateAt = importTimestamp(candidate.import_id, importImportedAtById);
  const incumbentAt = importTimestamp(incumbent.import_id, importImportedAtById);
  if (candidateAt !== incumbentAt) return candidateAt > incumbentAt;

  const candidateDate = normDate(candidate.date_saved);
  const incumbentDate = normDate(incumbent.date_saved);
  if (candidateDate !== incumbentDate) return candidateDate > incumbentDate;

  return candidate.row_index >= incumbent.row_index;
}

/** Keep one row per full-row fingerprint (newest import / date_saved wins). */
export function dedupeEpicCarePlanRows(
  rows: EpicCarePlanRow[],
  importImportedAtById?: ReadonlyMap<string, string>
): EpicCarePlanRow[] {
  const bestByFingerprint = new Map<string, EpicCarePlanRow>();
  for (const row of rows) {
    const fingerprint = carePlanRowFingerprint(row);
    const existing = bestByFingerprint.get(fingerprint);
    if (!existing || preferCarePlanRow(row, existing, importImportedAtById)) {
      bestByFingerprint.set(fingerprint, row);
    }
  }
  return [...bestByFingerprint.values()];
}

export async function fetchCarePlanFingerprintsFromDb(): Promise<Set<string>> {
  const { data, error } = await fetchAllSupabaseRows<CarePlanDedupSnapshot>(
    (client, from, to) =>
      client
        .from('epic_conversion_care_plan_rows')
        .select(
          'brn, client_id, offer_id, goldcare_id, patient_name, client_needs_goals, service_teaching_plan, outcomes, goal_met, date_saved'
        )
        .order('id', { ascending: true })
        .range(from, to),
    supabase
  );

  if (error) {
    throw new Error(error.message);
  }

  return collectCarePlanFingerprints(data);
}

export function carePlanRowsMatchForDedup(
  a: CarePlanDedupSnapshot,
  b: CarePlanDedupSnapshot
): boolean {
  return carePlanRowFingerprint(a) === carePlanRowFingerprint(b);
}

/**
 * Drop duplicate care plan rows (full-row match). Keeps first occurrence in file order,
 * then skips rows that match any fingerprint in `existingFingerprints`.
 */
export function dedupeCarePlanInsertRows(
  rows: CarePlanInsertRow[],
  existingFingerprints: ReadonlySet<string> = new Set()
): { rows: CarePlanInsertRow[]; skippedDuplicates: number } {
  const seen = new Set(existingFingerprints);
  const deduped: CarePlanInsertRow[] = [];
  let skippedDuplicates = 0;

  for (const row of rows) {
    const fingerprint = carePlanRowFingerprint(row);
    if (seen.has(fingerprint)) {
      skippedDuplicates += 1;
      continue;
    }
    seen.add(fingerprint);
    deduped.push({ ...row, row_index: deduped.length });
  }

  return { rows: deduped, skippedDuplicates };
}

export function collectCarePlanFingerprints(
  rows: readonly (CarePlanDedupSnapshot | EpicCarePlanRow)[]
): Set<string> {
  const fingerprints = new Set<string>();
  for (const row of rows) {
    fingerprints.add(carePlanRowFingerprint(row));
  }
  return fingerprints;
}
