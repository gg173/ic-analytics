import type { EpicConversionRecord } from '../types';

export function mergeRecordPatches(
  records: EpicConversionRecord[],
  patches: Map<string, Partial<EpicConversionRecord>>
): EpicConversionRecord[] {
  if (!patches.size) return records;
  return records.map((record) => {
    const patch = patches.get(record.id);
    if (!patch) return record;
    return {
      ...record,
      ...patch,
      updated_at: patch.updated_at ?? new Date().toISOString(),
    };
  });
}

/** Prepend newly inserted rows (same sort key as refresh: imported_at desc, mrn asc). */
export function prependInsertedRecords(
  records: EpicConversionRecord[],
  inserted: EpicConversionRecord[]
): EpicConversionRecord[] {
  if (!inserted.length) return records;
  const merged = [...inserted, ...records];
  merged.sort((a, b) => {
    const at = a.imported_at.localeCompare(b.imported_at);
    if (at !== 0) return -at;
    return a.mrn.localeCompare(b.mrn);
  });
  return merged;
}
