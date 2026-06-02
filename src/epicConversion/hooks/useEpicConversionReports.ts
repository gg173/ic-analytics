import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { EpicConversionRecord } from '../types';
import { parseEpicConversionReportBuffer } from '../ingest/parseEpicConversionReport';
import { mergeEpicReportRowsByMrn } from '../reconciliation/mergeEpicReportRows';
import {
  buildReconciliationDetails,
  findConvertedRecordsMissingFromEpic,
  getLatestEpicImportedAt,
  isDiscrepancyOutcome,
  isEpicReconciliationDiscrepancy,
  reconcileReportRows,
  summarizeReconciliationOutcomes,
  summarizeReconciliationOutcomesExcludingPendingAdjudication,
} from '../reconciliation/reconcileReportRows';
import type {
  EpicConversionReconciliationResult,
  EpicConversionReportImport,
  EpicConversionReportRow,
  ReconciliationDetailRow,
  ReconciliationOutcome,
  ReconciliationSummary,
} from '../reconciliation/types';

const REPORT_ROW_CHUNK = 400;
const RECONCILIATION_CHUNK = 400;

export interface EpicReportUploadResult {
  error: string | null;
  importId: string | null;
  rowCount: number;
  summary: ReconciliationSummary | null;
}

function summarizeOutcomes(
  rows: { outcome: ReconciliationOutcome }[]
): Pick<
  ReconciliationSummary,
  'validated' | 'statusDiscrepancy' | 'fieldDiscrepancy' | 'unmatched' | 'missingFromEpic'
> {
  return summarizeReconciliationOutcomes(rows);
}

async function fetchSummaryForImport(
  importId: string,
  meta: EpicConversionReportImport
): Promise<ReconciliationSummary> {
  const { data } = await supabase
    .from('epic_conversion_reconciliation_results')
    .select('outcome')
    .eq('import_id', importId);

  const counts = summarizeOutcomes((data as { outcome: ReconciliationOutcome }[]) ?? []);

  return {
    importId,
    filename: meta.source_filename,
    importedAt: meta.imported_at,
    totalRows: meta.row_count,
    ...counts,
  };
}

export function useEpicConversionReports(vhaRecords: EpicConversionRecord[]) {
  const [imports, setImports] = useState<EpicConversionReportImport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [latestSummary, setLatestSummary] = useState<ReconciliationSummary | null>(null);
  const [importSummariesById, setImportSummariesById] = useState<
    Map<string, ReconciliationSummary>
  >(() => new Map());
  const [reconciliationDetails, setReconciliationDetails] = useState<ReconciliationDetailRow[]>(
    []
  );
  const [unifiedReconciliationDetails, setUnifiedReconciliationDetails] = useState<
    ReconciliationDetailRow[]
  >([]);
  const [detailsImportId, setDetailsImportId] = useState<string | null>(null);
  const [recheckingImportId, setRecheckingImportId] = useState<string | null>(null);
  const [recheckingUnified, setRecheckingUnified] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: fetchError } = await supabase
      .from('epic_conversion_report_imports')
      .select('*')
      .order('imported_at', { ascending: false });

    if (fetchError) {
      setError(fetchError.message);
      setImports([]);
      setLatestSummary(null);
      setImportSummariesById(new Map());
    } else {
      const list = (data as EpicConversionReportImport[]) ?? [];
      setImports(list);
      const summaries = new Map<string, ReconciliationSummary>();
      await Promise.all(
        list.map(async (imp) => {
          summaries.set(imp.id, await fetchSummaryForImport(imp.id, imp));
        })
      );
      setImportSummariesById(summaries);
      setLatestSummary(list.length ? summaries.get(list[0].id) ?? null : null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const loadUnifiedReconciliationDetails = useCallback(async () => {
    const { data: importRows, error: importsError } = await supabase
      .from('epic_conversion_report_imports')
      .select('id, imported_at, source_filename');

    if (importsError) {
      setUnifiedReconciliationDetails([]);
      return [];
    }

    const importMetaById = new Map(
      ((importRows as { id: string; imported_at: string; source_filename: string }[]) ?? []).map(
        (imp) => [imp.id, imp]
      )
    );
    const importFilenameById = new Map(
      [...importMetaById.entries()].map(([id, imp]) => [id, imp.source_filename])
    );

    if (!importMetaById.size) {
      setUnifiedReconciliationDetails([]);
      return [];
    }

    const { data: reportRows, error: rowsError } = await supabase
      .from('epic_conversion_report_rows')
      .select('*')
      .order('row_index', { ascending: true });

    if (rowsError) {
      setUnifiedReconciliationDetails([]);
      return [];
    }

    const rowsWithMeta = ((reportRows as EpicConversionReportRow[]) ?? [])
      .map((row) => ({
        ...row,
        importedAt: importMetaById.get(row.import_id)?.imported_at ?? '',
      }))
      .filter((row) => row.importedAt);

    const mergedRows = mergeEpicReportRowsByMrn(rowsWithMeta);
    const latestEpicImportedAt = getLatestEpicImportedAt(
      [...importMetaById.values()].map((imp) => imp.imported_at)
    );
    const reconciliation = reconcileReportRows(mergedRows, vhaRecords);
    const recordsById = new Map(vhaRecords.map((r) => [r.id, r]));
    const epicDetails = buildReconciliationDetails(
      mergedRows,
      reconciliation,
      recordsById,
      importFilenameById
    );
    const missingFromEpic = findConvertedRecordsMissingFromEpic(
      vhaRecords,
      mergedRows,
      latestEpicImportedAt
    );
    const details = [...epicDetails, ...missingFromEpic];
    setUnifiedReconciliationDetails(details);
    return details;
  }, [vhaRecords]);

  const uploadReport = useCallback(
    async (file: File, importedBy?: string | null): Promise<EpicReportUploadResult> => {
      try {
        const buf = await file.arrayBuffer();
        const parsed = parseEpicConversionReportBuffer(buf);
        if (parsed.errors.length) {
          return {
            error: parsed.errors.slice(0, 5).join('; '),
            importId: null,
            rowCount: 0,
            summary: null,
          };
        }

        const importedAt = new Date().toISOString();
        const { data: importRow, error: importError } = await supabase
          .from('epic_conversion_report_imports')
          .insert({
            source_filename: file.name,
            imported_at: importedAt,
            imported_by: importedBy ?? null,
            row_count: parsed.rows.length,
          })
          .select('*')
          .single();

        if (importError || !importRow) {
          return {
            error: importError?.message ?? 'Failed to save report import',
            importId: null,
            rowCount: 0,
            summary: null,
          };
        }

        const importId = (importRow as EpicConversionReportImport).id;
        const insertedRows: EpicConversionReportRow[] = [];

        for (let i = 0; i < parsed.rows.length; i += REPORT_ROW_CHUNK) {
          const chunk = parsed.rows.slice(i, i + REPORT_ROW_CHUNK).map((row) => ({
            import_id: importId,
            patient_name: row.patient_name,
            epic_episode: row.epic_episode,
            mrn: row.mrn,
            pathway: row.pathway,
            hosp_dc_date: null,
            ic_lead: row.ic_lead,
            row_index: row.row_index,
          }));

          const { data: rowData, error: rowError } = await supabase
            .from('epic_conversion_report_rows')
            .insert(chunk)
            .select('*');

          if (rowError) {
            await supabase.from('epic_conversion_report_imports').delete().eq('id', importId);
            return { error: rowError.message, importId: null, rowCount: 0, summary: null };
          }
          insertedRows.push(...((rowData as EpicConversionReportRow[]) ?? []));
        }

        const reconciliation = reconcileReportRows(insertedRows, vhaRecords);

        for (let i = 0; i < reconciliation.length; i += RECONCILIATION_CHUNK) {
          const chunk = reconciliation.slice(i, i + RECONCILIATION_CHUNK).map((row) => ({
            import_id: importId,
            report_row_id: row.report_row_id,
            matched_record_id: row.matched_record_id,
            outcome: row.outcome,
            field_discrepancies: row.field_discrepancies,
          }));

          const { error: reconcileError } = await supabase
            .from('epic_conversion_reconciliation_results')
            .insert(chunk);

          if (reconcileError) {
            await supabase.from('epic_conversion_report_imports').delete().eq('id', importId);
            return { error: reconcileError.message, importId: null, rowCount: 0, summary: null };
          }
        }

        const summary: ReconciliationSummary = {
          importId,
          filename: file.name,
          importedAt,
          totalRows: parsed.rows.length,
          ...summarizeOutcomes(reconciliation),
        };

        await refresh();
        setLatestSummary(summary);
        const recordsById = new Map(vhaRecords.map((r) => [r.id, r]));
        setReconciliationDetails(
          buildReconciliationDetails(
            insertedRows,
            reconciliation,
            recordsById,
            new Map([[importId, file.name]])
          )
        );
        setDetailsImportId(importId);
        await loadUnifiedReconciliationDetails();
        return { error: null, importId, rowCount: parsed.rows.length, summary };
      } catch (err) {
        return {
          error: err instanceof Error ? err.message : 'Upload failed',
          importId: null,
          rowCount: 0,
          summary: null,
        };
      }
    },
    [vhaRecords, refresh, loadUnifiedReconciliationDetails]
  );

  const loadReconciliationDetails = useCallback(
    async (importId: string) => {
      const [{ data: reportRows }, { data: results }] = await Promise.all([
        supabase
          .from('epic_conversion_report_rows')
          .select('*')
          .eq('import_id', importId)
          .order('row_index', { ascending: true }),
        supabase
          .from('epic_conversion_reconciliation_results')
          .select('*')
          .eq('import_id', importId),
      ]);

      const rows = (reportRows as EpicConversionReportRow[]) ?? [];
      const resultRows = (results as EpicConversionReconciliationResult[]) ?? [];
      const recordsById = new Map(vhaRecords.map((r) => [r.id, r]));

      const runRows = resultRows.map((r) => ({
        report_row_id: r.report_row_id,
        matched_record_id: r.matched_record_id,
        outcome: r.outcome,
        field_discrepancies: r.field_discrepancies,
      }));

      const importFilenameById = new Map(imports.map((imp) => [imp.id, imp.source_filename]));
      const details = buildReconciliationDetails(rows, runRows, recordsById, importFilenameById);
      setReconciliationDetails(details);
      setDetailsImportId(importId);
      return details;
    },
    [vhaRecords, imports]
  );

  const recheckReconciliation = useCallback(
    async (
      importId: string,
      options?: { updateView?: boolean; skipRefresh?: boolean }
    ): Promise<{ error: string | null }> => {
      const updateView = options?.updateView !== false;
      const skipRefresh = options?.skipRefresh === true;
      if (updateView) {
        setRecheckingImportId(importId);
      }
      try {
        const { data: reportRows, error: rowsError } = await supabase
          .from('epic_conversion_report_rows')
          .select('*')
          .eq('import_id', importId)
          .order('row_index', { ascending: true });

        if (rowsError) {
          return { error: rowsError.message };
        }

        const rows = (reportRows as EpicConversionReportRow[]) ?? [];
        const reconciliation = reconcileReportRows(rows, vhaRecords);

        const { error: deleteError } = await supabase
          .from('epic_conversion_reconciliation_results')
          .delete()
          .eq('import_id', importId);

        if (deleteError) {
          return { error: deleteError.message };
        }

        for (let i = 0; i < reconciliation.length; i += RECONCILIATION_CHUNK) {
          const chunk = reconciliation.slice(i, i + RECONCILIATION_CHUNK).map((row) => ({
            import_id: importId,
            report_row_id: row.report_row_id,
            matched_record_id: row.matched_record_id,
            outcome: row.outcome,
            field_discrepancies: row.field_discrepancies,
          }));

          const { error: reconcileError } = await supabase
            .from('epic_conversion_reconciliation_results')
            .insert(chunk);

          if (reconcileError) {
            return { error: reconcileError.message };
          }
        }

        if (updateView) {
          const recordsById = new Map(vhaRecords.map((r) => [r.id, r]));
          const importFilenameById = new Map(imports.map((imp) => [imp.id, imp.source_filename]));
          setReconciliationDetails(
            buildReconciliationDetails(rows, reconciliation, recordsById, importFilenameById)
          );
          setDetailsImportId(importId);
        }
        if (!skipRefresh) {
          await refresh();
        }
        return { error: null };
      } catch (err) {
        return {
          error: err instanceof Error ? err.message : 'Recheck failed',
        };
      } finally {
        if (updateView) {
          setRecheckingImportId(null);
        }
      }
    },
    [vhaRecords, refresh, imports]
  );

  const recheckUnifiedReconciliation = useCallback(async (): Promise<{ error: string | null }> => {
    if (!imports.length) {
      return { error: null };
    }

    setRecheckingUnified(true);
    try {
      for (const imp of imports) {
        const result = await recheckReconciliation(imp.id, {
          updateView: false,
          skipRefresh: true,
        });
        if (result.error) {
          return result;
        }
      }
      await refresh();
      await loadUnifiedReconciliationDetails();
      if (detailsImportId) {
        await loadReconciliationDetails(detailsImportId);
      }
      return { error: null };
    } finally {
      setRecheckingUnified(false);
    }
  }, [
    imports,
    detailsImportId,
    recheckReconciliation,
    loadUnifiedReconciliationDetails,
    loadReconciliationDetails,
  ]);

  const fetchReportRowsForImport = useCallback(async (importId: string) => {
    const { data, error: fetchError } = await supabase
      .from('epic_conversion_report_rows')
      .select('*')
      .eq('import_id', importId)
      .order('row_index', { ascending: true });

    if (fetchError) {
      return { rows: null, error: fetchError.message };
    }
    return { rows: (data as EpicConversionReportRow[]) ?? [], error: null as string | null };
  }, []);

  const deleteReport = useCallback(
    async (importId: string) => {
      const { error: deleteError } = await supabase
        .from('epic_conversion_report_imports')
        .delete()
        .eq('id', importId);

      if (deleteError) return { error: deleteError.message };
      if (detailsImportId === importId) {
        setReconciliationDetails([]);
        setDetailsImportId(null);
      }
      await refresh();
      await loadUnifiedReconciliationDetails();
      return { error: null as string | null };
    },
    [detailsImportId, refresh, loadUnifiedReconciliationDetails]
  );

  const recordsById = useMemo(
    () => new Map(vhaRecords.map((r) => [r.id, r])),
    [vhaRecords]
  );

  const latestEpicImportedAt = useMemo(
    () => (imports.length ? getLatestEpicImportedAt(imports.map((imp) => imp.imported_at)) : null),
    [imports]
  );

  const unifiedDiscrepancyDetails = useMemo(
    () =>
      unifiedReconciliationDetails.filter((row) =>
        isEpicReconciliationDiscrepancy(row, recordsById, latestEpicImportedAt)
      ),
    [unifiedReconciliationDetails, recordsById, latestEpicImportedAt]
  );

  const unifiedSummary = useMemo((): ReconciliationSummary | null => {
    if (!imports.length) return null;
    const latest = imports[0];
    const epicRowCount = unifiedReconciliationDetails.filter(
      (row) => !row.reportRowId.startsWith('vha-missing:')
    ).length;
    return {
      importId: latest.id,
      filename: latest.source_filename,
      importedAt: latest.imported_at,
      totalRows: epicRowCount,
      ...summarizeReconciliationOutcomesExcludingPendingAdjudication(
        unifiedReconciliationDetails,
        recordsById,
        latestEpicImportedAt
      ),
    };
  }, [imports, unifiedReconciliationDetails, recordsById, latestEpicImportedAt]);

  const discrepancyDetails = reconciliationDetails.filter((row) =>
    isDiscrepancyOutcome(row.outcome)
  );

  return {
    reportImports: imports,
    reportLoading: loading,
    reportError: error,
    latestSummary,
    unifiedSummary,
    importSummariesById,
    reconciliationDetails,
    unifiedReconciliationDetails,
    discrepancyDetails,
    unifiedDiscrepancyDetails,
    detailsImportId,
    recheckingImportId,
    recheckingUnified,
    refreshReports: refresh,
    uploadReport,
    loadReconciliationDetails,
    loadUnifiedReconciliationDetails,
    recheckReconciliation,
    recheckUnifiedReconciliation,
    fetchReportRowsForImport,
    deleteReport,
  };
}
