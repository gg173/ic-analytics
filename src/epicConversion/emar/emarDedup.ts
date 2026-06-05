import { fetchAllSupabaseRows } from '../hooks/fetchAllSupabaseRows';
import { supabase } from '../../lib/supabase';
import { normalizeMrnForMatch } from '../reconciliation/reconcileReportRows';
import type { EmarInsertRow, EpicEmarRow } from './types';

export const EMAR_DEDUP_FIELD_NAMES = [
  'brn',
  'client_id',
  'offer_id',
  'goldcare_id',
  'medication_name',
  'last_admin_at',
  'dose',
  'route',
  'frequency',
  'total_number_of_doses',
  'order_or_dispensed_date',
  'end_date',
] as const;

export type EmarDedupFields = (typeof EMAR_DEDUP_FIELD_NAMES)[number];

export type EmarDedupSnapshot = Pick<EmarInsertRow, EmarDedupFields>;

function normStr(value: string | null | undefined): string {
  return (value ?? '').trim();
}

function normOptionalStr(value: string | null | undefined): string {
  return normStr(value).replace(/\s+/g, ' ');
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

export function emarRowFingerprint(row: EmarDedupSnapshot): string {
  return EMAR_DEDUP_FIELD_NAMES.map((field) => {
    const value = row[field];
    if (field === 'brn') return normBrn(value);
    if (field === 'order_or_dispensed_date' || field === 'end_date') return normDate(value);
    return normOptionalStr(value);
  }).join('\0');
}

function importTimestamp(
  importId: string,
  importImportedAtById?: ReadonlyMap<string, string>
): string {
  return importImportedAtById?.get(importId) ?? '';
}

function preferEmarRow(
  candidate: EpicEmarRow,
  incumbent: EpicEmarRow,
  importImportedAtById?: ReadonlyMap<string, string>
): boolean {
  const candidateAt = importTimestamp(candidate.import_id, importImportedAtById);
  const incumbentAt = importTimestamp(incumbent.import_id, importImportedAtById);
  if (candidateAt !== incumbentAt) return candidateAt > incumbentAt;
  return candidate.row_index >= incumbent.row_index;
}

export function dedupeEpicEmarRows(
  rows: EpicEmarRow[],
  importImportedAtById?: ReadonlyMap<string, string>
): EpicEmarRow[] {
  const bestByFingerprint = new Map<string, EpicEmarRow>();
  for (const row of rows) {
    const fingerprint = emarRowFingerprint(row);
    const existing = bestByFingerprint.get(fingerprint);
    if (!existing || preferEmarRow(row, existing, importImportedAtById)) {
      bestByFingerprint.set(fingerprint, row);
    }
  }
  return [...bestByFingerprint.values()];
}

export async function fetchEmarFingerprintsFromDb(): Promise<Set<string>> {
  const { data, error } = await fetchAllSupabaseRows<EmarDedupSnapshot>(
    (client, from, to) =>
      client
        .from('epic_conversion_emar_rows')
        .select(
          'brn, client_id, offer_id, goldcare_id, medication_name, last_admin_at, dose, route, frequency, total_number_of_doses, order_or_dispensed_date, end_date'
        )
        .order('id', { ascending: true })
        .range(from, to),
    supabase
  );

  if (error) {
    throw new Error(error.message);
  }

  const fingerprints = new Set<string>();
  for (const row of data) {
    fingerprints.add(emarRowFingerprint(row));
  }
  return fingerprints;
}

export function dedupeEmarInsertRows(
  rows: EmarInsertRow[],
  existingFingerprints: ReadonlySet<string> = new Set()
): { rows: EmarInsertRow[]; skippedDuplicates: number } {
  const seen = new Set(existingFingerprints);
  const deduped: EmarInsertRow[] = [];
  let skippedDuplicates = 0;

  for (const row of rows) {
    const fingerprint = emarRowFingerprint(row);
    if (seen.has(fingerprint)) {
      skippedDuplicates += 1;
      continue;
    }
    seen.add(fingerprint);
    deduped.push({ ...row, row_index: deduped.length });
  }

  return { rows: deduped, skippedDuplicates };
}
