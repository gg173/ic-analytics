import type { EpicConversionReportImport } from '../reconciliation/types';
import type { ReconciliationSummary } from '../reconciliation/types';
import {
  formatStrategyBreakdown,
  type ImportActivityRow,
} from './computeImportActivity';
import type { StrategyBreakdown } from './recordStrategyTabs';

export type UploadActivityType = 'ssdb' | 'epic';

export interface UnifiedImportActivityRow {
  type: UploadActivityType;
  filename: string;
  importedAt: string;
  importedBy: string | null;
  rowCount: number;
  strategyBreakdown?: StrategyBreakdown;
  validatedCount?: number;
  discrepancyCount?: number;
}

export function epicDiscrepancyCount(summary: ReconciliationSummary): number {
  return summary.statusDiscrepancy + summary.fieldDiscrepancy + summary.unmatched;
}

export function formatEpicResults(validated: number, discrepancies: number): string {
  return `${validated} validated, ${discrepancies} discrepanc${discrepancies === 1 ? 'y' : 'ies'}`;
}

export function formatUnifiedImportResults(row: UnifiedImportActivityRow): string {
  if (row.type === 'ssdb' && row.strategyBreakdown) {
    return formatStrategyBreakdown(row.strategyBreakdown);
  }
  if (row.type === 'epic') {
    return formatEpicResults(row.validatedCount ?? 0, row.discrepancyCount ?? 0);
  }
  return '—';
}

export function uploadTypeLabel(type: UploadActivityType): string {
  return type === 'ssdb' ? 'SSDB' : 'Epic';
}

export function buildUnifiedImportActivity(
  ssdbRows: ImportActivityRow[],
  epicImports: EpicConversionReportImport[],
  epicSummariesById: Map<string, ReconciliationSummary>
): UnifiedImportActivityRow[] {
  const unified: UnifiedImportActivityRow[] = [
    ...ssdbRows.map((row) => ({
      type: 'ssdb' as const,
      filename: row.filename,
      importedAt: row.importedAt,
      importedBy: row.importedBy,
      rowCount: row.rowCount,
      strategyBreakdown: row.strategyBreakdown,
    })),
    ...epicImports.map((imp) => {
      const summary = epicSummariesById.get(imp.id);
      return {
        type: 'epic' as const,
        filename: imp.source_filename,
        importedAt: imp.imported_at,
        importedBy: imp.imported_by,
        rowCount: imp.row_count,
        validatedCount: summary?.validated ?? 0,
        discrepancyCount: summary ? epicDiscrepancyCount(summary) : 0,
      };
    }),
  ];

  return unified.sort(
    (a, b) => new Date(b.importedAt).getTime() - new Date(a.importedAt).getTime()
  );
}
