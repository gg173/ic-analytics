import { getLatestEpicImportedAt, normalizeMrnForMatch } from './reconcileReportRows';
import type { EpicConversionReportRow } from './types';

export type EpicReportRowWithImportMeta = EpicConversionReportRow & {
  importedAt: string;
};

/**
 * Builds the Epic reconciliation snapshot from the most recent report upload.
 * Each Epic file is a full report rerun; MRNs absent from that file are treated
 * as removed from Epic (e.g. after deleting an episode and re-exporting).
 */
export function mergeEpicReportRowsByMrn(
  rows: EpicReportRowWithImportMeta[]
): EpicConversionReportRow[] {
  if (!rows.length) return [];

  const latestImportedAt = getLatestEpicImportedAt(rows.map((row) => row.importedAt));
  if (!latestImportedAt) return [];

  const sorted = [...rows]
    .filter((row) => row.importedAt === latestImportedAt)
    .sort((a, b) => b.row_index - a.row_index);

  const byMrn = new Map<string, EpicConversionReportRow>();
  for (const row of sorted) {
    const key = normalizeMrnForMatch(row.mrn);
    if (!key || byMrn.has(key)) continue;
    const { importedAt: _importedAt, ...reportRow } = row;
    byMrn.set(key, reportRow);
  }

  return [...byMrn.values()].sort((a, b) => a.mrn.localeCompare(b.mrn));
}
