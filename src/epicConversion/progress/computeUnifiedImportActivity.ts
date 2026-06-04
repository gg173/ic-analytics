import type { EpicConversionReportImport } from '../reconciliation/types';
import type { ReconciliationSummary } from '../reconciliation/types';
import { classifyClientNeedsGoals } from '../carePlan/classifyCarePlanContent';
import type { EpicCarePlanImport, EpicCarePlanRow } from '../carePlan/types';
import {
  formatStrategyBreakdown,
  type ImportActivityRow,
} from './computeImportActivity';
import type { StrategyBreakdown } from './recordStrategyTabs';

export type UploadActivityType = 'ssdb' | 'epic' | 'emri';

export interface UnifiedImportActivityRow {
  type: UploadActivityType;
  filename: string;
  importedAt: string;
  importedBy: string | null;
  rowCount: number;
  strategyBreakdown?: StrategyBreakdown;
  validatedCount?: number;
  discrepancyCount?: number;
  templatedCount?: number;
  unstructuredCount?: number;
}

export function epicDiscrepancyCount(summary: ReconciliationSummary): number {
  return summary.statusDiscrepancy + summary.fieldDiscrepancy + summary.unmatched;
}

export function formatEpicResults(validated: number, discrepancies: number): string {
  return `${validated} validated, ${discrepancies} discrepanc${discrepancies === 1 ? 'y' : 'ies'}`;
}

export function formatEmriResults(templated: number, unstructured: number): string {
  return `${templated} templated, ${unstructured} unstructured`;
}

export function formatUnifiedImportResults(row: UnifiedImportActivityRow): string {
  if (row.type === 'ssdb' && row.strategyBreakdown) {
    return formatStrategyBreakdown(row.strategyBreakdown);
  }
  if (row.type === 'epic') {
    return formatEpicResults(row.validatedCount ?? 0, row.discrepancyCount ?? 0);
  }
  if (row.type === 'emri') {
    return formatEmriResults(row.templatedCount ?? 0, row.unstructuredCount ?? 0);
  }
  return '—';
}

export function uploadTypeLabel(type: UploadActivityType): string {
  if (type === 'ssdb') return 'SSDB';
  if (type === 'epic') return 'Epic';
  return 'EMRI';
}

function countCarePlanContentByImportId(
  carePlanRows: EpicCarePlanRow[]
): Map<string, { templated: number; unstructured: number }> {
  const counts = new Map<string, { templated: number; unstructured: number }>();
  for (const row of carePlanRows) {
    const existing = counts.get(row.import_id) ?? { templated: 0, unstructured: 0 };
    if (classifyClientNeedsGoals(row.client_needs_goals) === 'templated') {
      existing.templated += 1;
    } else {
      existing.unstructured += 1;
    }
    counts.set(row.import_id, existing);
  }
  return counts;
}

export function buildUnifiedImportActivity(
  ssdbRows: ImportActivityRow[],
  epicImports: EpicConversionReportImport[],
  epicSummariesById: Map<string, ReconciliationSummary>,
  carePlanImports: EpicCarePlanImport[] = [],
  carePlanRows: EpicCarePlanRow[] = []
): UnifiedImportActivityRow[] {
  const carePlanContentByImportId = countCarePlanContentByImportId(carePlanRows);

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
    ...carePlanImports.map((imp) => {
      const content = carePlanContentByImportId.get(imp.id);
      return {
        type: 'emri' as const,
        filename: imp.source_filename,
        importedAt: imp.imported_at,
        importedBy: imp.imported_by,
        rowCount: imp.row_count,
        templatedCount: content?.templated ?? 0,
        unstructuredCount: content?.unstructured ?? 0,
      };
    }),
  ];

  return unified.sort(
    (a, b) => new Date(b.importedAt).getTime() - new Date(a.importedAt).getTime()
  );
}
