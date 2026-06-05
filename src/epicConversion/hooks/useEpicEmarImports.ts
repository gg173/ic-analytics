import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { dedupeEmarInsertRows, dedupeEpicEmarRows, fetchEmarFingerprintsFromDb } from '../emar/emarDedup';
import { parseEmarXlsxBuffer } from '../emar/parseEmarXlsx';
import {
  buildEmarEnrolmentLinkIndex,
  resolveEmarEnrolmentLink,
} from '../emar/resolveEmarEnrolmentLink';
import type { EmarInsertRow, EpicEmarImport, EpicEmarRow } from '../emar/types';
import type { EpicConversionRecord } from '../types';
import { fetchAllSupabaseRows } from './fetchAllSupabaseRows';

const ROW_CHUNK = 400;

export interface EmarUploadResult {
  error: string | null;
  importId: string | null;
  rowCount: number;
  linkedCount: number;
  skippedDuplicates: number;
  emarRows: EpicEmarRow[];
  imports: EpicEmarImport[];
}

export function useEpicEmarImports() {
  const [imports, setImports] = useState<EpicEmarImport[]>([]);
  const [emarRows, setEmarRows] = useState<EpicEmarRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<{
    imports: EpicEmarImport[];
    emarRows: EpicEmarRow[];
    error: string | null;
  }> => {
    setLoading(true);
    setError(null);

    const { data: importData, error: importError } = await supabase
      .from('epic_conversion_emar_imports')
      .select('*')
      .order('imported_at', { ascending: false });

    if (importError) {
      setError(importError.message);
      setImports([]);
      setEmarRows([]);
      setLoading(false);
      return { imports: [], emarRows: [], error: importError.message };
    }

    const list = (importData as EpicEmarImport[]) ?? [];
    setImports(list);

    if (!list.length) {
      setEmarRows([]);
      setLoading(false);
      return { imports: [], emarRows: [], error: null };
    }

    const importIds = list.map((imp) => imp.id);
    const { data: rowData, error: rowError } = await fetchAllSupabaseRows<EpicEmarRow>(
      (client, from, to) =>
        client
          .from('epic_conversion_emar_rows')
          .select('*')
          .in('import_id', importIds)
          .order('row_index', { ascending: true })
          .range(from, to),
      supabase
    );

    if (rowError) {
      setError(rowError.message);
      setEmarRows([]);
      setLoading(false);
      return { imports: list, emarRows: [], error: rowError.message };
    }

    const importImportedAtById = new Map(list.map((imp) => [imp.id, imp.imported_at]));
    const dedupedRows = dedupeEpicEmarRows(rowData, importImportedAtById);
    setEmarRows(dedupedRows);
    setLoading(false);
    return { imports: list, emarRows: dedupedRows, error: null };
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const uploadEmar = useCallback(
    async (file: File, importedBy?: string | null): Promise<EmarUploadResult> => {
      try {
        const buf = await file.arrayBuffer();
        const parsed = parseEmarXlsxBuffer(buf);
        if (parsed.errors.length) {
          return {
            error: parsed.errors.slice(0, 5).join('; '),
            importId: null,
            rowCount: 0,
            linkedCount: 0,
            skippedDuplicates: 0,
            emarRows: [],
            imports: [],
          };
        }

        let existingFingerprints: Set<string>;
        try {
          existingFingerprints = await fetchEmarFingerprintsFromDb();
        } catch (fetchErr) {
          return {
            error:
              fetchErr instanceof Error
                ? fetchErr.message
                : 'Failed to load existing eMAR rows for deduplication',
            importId: null,
            rowCount: 0,
            linkedCount: 0,
            skippedDuplicates: 0,
            emarRows: [],
            imports: [],
          };
        }

        const { rows: dedupedRows, skippedDuplicates: skippedAgainstExisting } =
          dedupeEmarInsertRows(parsed.rows, existingFingerprints);
        const skippedDuplicates = parsed.skippedDuplicates + skippedAgainstExisting;

        if (!dedupedRows.length) {
          const refreshed = await refresh();
          return {
            error: refreshed.error,
            importId: null,
            rowCount: 0,
            linkedCount: 0,
            skippedDuplicates,
            emarRows: refreshed.emarRows,
            imports: refreshed.imports,
          };
        }

        const { data: enrolmentRecords, error: enrolmentError } =
          await fetchAllSupabaseRows<Pick<EpicConversionRecord, 'id' | 'enroll_id' | 'mrn' | 'gcn'>>(
            (client, from, to) =>
              client
                .from('epic_conversion_records')
                .select('id, enroll_id, mrn, gcn')
                .order('id', { ascending: true })
                .range(from, to),
            supabase
          );

        if (enrolmentError) {
          return {
            error: enrolmentError.message,
            importId: null,
            rowCount: 0,
            linkedCount: 0,
            skippedDuplicates,
            emarRows: [],
            imports: [],
          };
        }

        const enrolmentLinkIndex = buildEmarEnrolmentLinkIndex(enrolmentRecords);

        const importedAt = new Date().toISOString();
        const { data: importRow, error: importError } = await supabase
          .from('epic_conversion_emar_imports')
          .insert({
            source_filename: file.name,
            imported_at: importedAt,
            imported_by: importedBy ?? null,
            row_count: dedupedRows.length,
            linked_count: 0,
          })
          .select('*')
          .single();

        if (importError || !importRow) {
          return {
            error: importError?.message ?? 'Failed to save eMAR import',
            importId: null,
            rowCount: 0,
            linkedCount: 0,
            skippedDuplicates,
            emarRows: [],
            imports: [],
          };
        }

        const importId = (importRow as EpicEmarImport).id;
        let linkedCount = 0;

        for (let i = 0; i < dedupedRows.length; i += ROW_CHUNK) {
          const chunk = dedupedRows
            .slice(i, i + ROW_CHUNK)
            .map((row) => toDbRow(row, importId, enrolmentLinkIndex, () => {
              linkedCount += 1;
            }));
          const { error: rowError } = await supabase.from('epic_conversion_emar_rows').insert(chunk);

          if (rowError) {
            await supabase.from('epic_conversion_emar_imports').delete().eq('id', importId);
            return {
              error: rowError.message,
              importId: null,
              rowCount: 0,
              linkedCount: 0,
              skippedDuplicates,
              emarRows: [],
              imports: [],
            };
          }
        }

        await supabase
          .from('epic_conversion_emar_imports')
          .update({ linked_count: linkedCount })
          .eq('id', importId);

        const refreshed = await refresh();
        return {
          error: refreshed.error,
          importId,
          rowCount: dedupedRows.length,
          linkedCount,
          skippedDuplicates,
          emarRows: refreshed.emarRows,
          imports: refreshed.imports,
        };
      } catch (err) {
        return {
          error: err instanceof Error ? err.message : 'Upload failed',
          importId: null,
          rowCount: 0,
          linkedCount: 0,
          skippedDuplicates: 0,
          emarRows: [],
          imports: [],
        };
      }
    },
    [refresh]
  );

  const deleteEmarImport = useCallback(
    async (importId: string): Promise<{ error: string | null }> => {
      const { error: deleteError } = await supabase
        .from('epic_conversion_emar_imports')
        .delete()
        .eq('id', importId);

      if (deleteError) {
        return { error: deleteError.message };
      }

      await refresh();
      return { error: null };
    },
    [refresh]
  );

  const fetchRowsForImport = useCallback(async (importId: string) => {
    const { data, error: fetchError } = await supabase
      .from('epic_conversion_emar_rows')
      .select('*')
      .eq('import_id', importId)
      .order('row_index', { ascending: true });

    if (fetchError) {
      return { rows: [] as EpicEmarRow[], error: fetchError.message };
    }
    return { rows: (data as EpicEmarRow[]) ?? [], error: null };
  }, []);

  return {
    imports,
    emarRows,
    loading,
    error,
    refresh,
    uploadEmar,
    deleteEmarImport,
    fetchRowsForImport,
  };
}

function toDbRow(
  row: EmarInsertRow,
  importId: string,
  enrolmentLinkIndex: ReturnType<typeof buildEmarEnrolmentLinkIndex>,
  onLinked: () => void
) {
  const link = resolveEmarEnrolmentLink(row, enrolmentLinkIndex);
  if (link) onLinked();

  return {
    import_id: importId,
    brn: row.brn,
    client_id: row.client_id,
    offer_id: row.offer_id,
    goldcare_id: row.goldcare_id,
    medication_name: row.medication_name,
    last_admin_at: row.last_admin_at,
    dose: row.dose,
    route: row.route,
    frequency: row.frequency,
    total_number_of_doses: row.total_number_of_doses,
    order_or_dispensed_date: row.order_or_dispensed_date,
    end_date: row.end_date,
    enroll_id: link?.enrollId ?? null,
    enrolment_record_id: link?.enrolmentRecordId ?? null,
    row_index: row.row_index,
  };
}
