import { normalizeMrnForMatch } from './reconcileReportRows';
import type { EpicConversionReportRow } from './types';

export type EpicReportRowWithImportMeta = EpicConversionReportRow & {
  importedAt: string;
};

/**
 * Builds one Epic snapshot across all uploads: for each MRN, the row from the
 * most recently imported report wins (same cumulative pattern as SSDB enrolment).
 */
export function mergeEpicReportRowsByMrn(
  rows: EpicReportRowWithImportMeta[]
): EpicConversionReportRow[] {
  const sorted = [...rows].sort((a, b) => {
    const byImport =
      new Date(b.importedAt).getTime() - new Date(a.importedAt).getTime();
    if (byImport !== 0) return byImport;
    return b.row_index - a.row_index;
  });

  const byMrn = new Map<string, EpicConversionReportRow>();
  for (const row of sorted) {
    const key = normalizeMrnForMatch(row.mrn);
    if (!key || byMrn.has(key)) continue;
    const { importedAt: _importedAt, ...reportRow } = row;
    byMrn.set(key, reportRow);
  }

  return [...byMrn.values()].sort((a, b) => a.mrn.localeCompare(b.mrn));
}
