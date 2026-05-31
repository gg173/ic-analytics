import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { EpicConversionRecord } from '../types';
import { parseEpicConversionReportBuffer } from '../ingest/parseEpicConversionReport';
import {
  buildReconciliationDetails,
  reconcileReportRows,
} from '../reconciliation/reconcileReportRows';
import type {
  EpicConversionReconciliationResult,
  EpicConversionReportImport,
  EpicConversionReportRow,
  ReconciliationDetailRow,
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

async function fetchSummaryForImport(
  importId: string,
  meta: EpicConversionReportImport
): Promise<ReconciliationSummary> {
  const { data } = await supabase
    .from('epic_conversion_reconciliation_results')
    .select('outcome')
    .eq('import_id', importId);

  let perfect = 0;
  let incorrect = 0;
  let unmatched = 0;
  for (const row of data ?? []) {
    if (row.outcome === 'perfect') perfect += 1;
    else if (row.outcome === 'incorrect') incorrect += 1;
    else if (row.outcome === 'unmatched') unmatched += 1;
  }

  return {
    importId,
    filename: meta.source_filename,
    importedAt: meta.imported_at,
    totalRows: meta.row_count,
    perfect,
    incorrect,
    unmatched,
  };
}

export function useEpicConversionReports(convertedRecords: EpicConversionRecord[]) {
  const [imports, setImports] = useState<EpicConversionReportImport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [latestSummary, setLatestSummary] = useState<ReconciliationSummary | null>(null);
  const [reconciliationDetails, setReconciliationDetails] = useState<ReconciliationDetailRow[]>(
    []
  );
  const [detailsImportId, setDetailsImportId] = useState<string | null>(null);

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
    } else {
      const list = (data as EpicConversionReportImport[]) ?? [];
      setImports(list);
      if (list.length) {
        setLatestSummary(await fetchSummaryForImport(list[0].id, list[0]));
      } else {
        setLatestSummary(null);
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const uploadReport = useCallback(
    async (file: File, importedBy?: string | null): Promise<EpicReportUploadResult> => {
      try {
        const buf = await file.arrayBuffer();
        const parsed = parseEpicConversionReportBuffer(buf);
        if (parsed.errors.length) {
          return {
            error: parsed.errors.slice(0, 4).join('; '),
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
            enroll_id: row.enroll_id,
            mrn: row.mrn,
            pathway: row.pathway,
            hosp_dc_date: row.hosp_dc_date,
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

        const reconciliation = reconcileReportRows(insertedRows, convertedRecords);

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
          perfect: reconciliation.filter((r) => r.outcome === 'perfect').length,
          incorrect: reconciliation.filter((r) => r.outcome === 'incorrect').length,
          unmatched: reconciliation.filter((r) => r.outcome === 'unmatched').length,
        };

        await refresh();
        setLatestSummary(summary);
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
    [convertedRecords, refresh]
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
      const recordsById = new Map(convertedRecords.map((r) => [r.id, r]));

      const runRows = resultRows.map((r) => ({
        report_row_id: r.report_row_id,
        matched_record_id: r.matched_record_id,
        outcome: r.outcome,
        field_discrepancies: r.field_discrepancies,
      }));

      const details = buildReconciliationDetails(rows, runRows, recordsById);
      setReconciliationDetails(details);
      setDetailsImportId(importId);
      return details;
    },
    [convertedRecords]
  );

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
      return { error: null as string | null };
    },
    [detailsImportId, refresh]
  );

  return {
    reportImports: imports,
    reportLoading: loading,
    reportError: error,
    latestSummary,
    reconciliationDetails,
    detailsImportId,
    refreshReports: refresh,
    uploadReport,
    loadReconciliationDetails,
    deleteReport,
  };
}
