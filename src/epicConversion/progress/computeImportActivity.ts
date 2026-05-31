import type { EpicConversionRecord } from '../types';
import { countStrategyBreakdown, type StrategyBreakdown } from './recordStrategyTabs';

export interface ImportActivityRow {
  filename: string;
  importedAt: string;
  importedBy: string | null;
  rowCount: number;
  strategyBreakdown: StrategyBreakdown;
}

export function computeImportActivity(records: EpicConversionRecord[]): ImportActivityRow[] {
  const byKey = new Map<
    string,
    {
      filename: string;
      importedAt: string;
      importedBy: string | null;
      records: EpicConversionRecord[];
    }
  >();

  for (const r of records) {
    const key = `${r.source_filename}\0${r.imported_at}`;
    const existing = byKey.get(key);
    if (existing) existing.records.push(r);
    else
      byKey.set(key, {
        filename: r.source_filename,
        importedAt: r.imported_at,
        importedBy: r.imported_by ?? null,
        records: [r],
      });
  }

  return [...byKey.values()]
    .map(({ filename, importedAt, importedBy, records: batchRecords }) => ({
      filename,
      importedAt,
      importedBy,
      rowCount: batchRecords.length,
      strategyBreakdown: countStrategyBreakdown(batchRecords),
    }))
    .sort((a, b) => new Date(b.importedAt).getTime() - new Date(a.importedAt).getTime());
}

export function formatStrategyBreakdown(breakdown: StrategyBreakdown): string {
  const parts: string[] = [];
  if (breakdown.episodeConversion) parts.push(`${breakdown.episodeConversion} Episode`);
  if (breakdown.iclReassessment) parts.push(`${breakdown.iclReassessment} ICL`);
  if (breakdown.programDischarge) parts.push(`${breakdown.programDischarge} Discharge`);
  if (breakdown.other) parts.push(`${breakdown.other} Other`);
  return parts.length ? parts.join(', ') : '—';
}
