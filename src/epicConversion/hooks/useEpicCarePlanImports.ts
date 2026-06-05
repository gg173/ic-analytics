import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import {
  dedupeCarePlanInsertRows,
  dedupeEpicCarePlanRows,
  fetchCarePlanFingerprintsFromDb,
} from '../carePlan/carePlanDedup';
import { parseCarePlanXlsxBuffer } from '../carePlan/parseCarePlanXlsx';
import type { CarePlanInsertRow, EpicCarePlanImport, EpicCarePlanRow } from '../carePlan/types';
import { fetchAllSupabaseRows } from './fetchAllSupabaseRows';

const ROW_CHUNK = 400;

export interface CarePlanUploadResult {
  error: string | null;
  importId: string | null;
  rowCount: number;
  skippedDuplicates: number;
  /** All care plan rows after a successful upload refresh. */
  carePlanRows: EpicCarePlanRow[];
  /** All care plan imports after a successful upload refresh. */
  imports: EpicCarePlanImport[];
}

export function useEpicCarePlanImports() {
  const [imports, setImports] = useState<EpicCarePlanImport[]>([]);
  const [carePlanRows, setCarePlanRows] = useState<EpicCarePlanRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<{
    imports: EpicCarePlanImport[];
    carePlanRows: EpicCarePlanRow[];
    error: string | null;
  }> => {
    setLoading(true);
    setError(null);

    const { data: importData, error: importError } = await supabase
      .from('epic_conversion_care_plan_imports')
      .select('*')
      .order('imported_at', { ascending: false });

    if (importError) {
      setError(importError.message);
      setImports([]);
      setCarePlanRows([]);
      setLoading(false);
      return { imports: [], carePlanRows: [], error: importError.message };
    }

    const list = (importData as EpicCarePlanImport[]) ?? [];
    setImports(list);

    if (!list.length) {
      setCarePlanRows([]);
      setLoading(false);
      return { imports: [], carePlanRows: [], error: null };
    }

    const importIds = list.map((imp) => imp.id);
    const { data: rowData, error: rowError } = await fetchAllSupabaseRows<EpicCarePlanRow>(
      (client, from, to) =>
        client
          .from('epic_conversion_care_plan_rows')
          .select('*')
          .in('import_id', importIds)
          .order('row_index', { ascending: true })
          .range(from, to),
      supabase
    );

    if (rowError) {
      setError(rowError.message);
      setCarePlanRows([]);
      setLoading(false);
      return { imports: list, carePlanRows: [], error: rowError.message };
    }

    const importImportedAtById = new Map(list.map((imp) => [imp.id, imp.imported_at]));
    const dedupedRows = dedupeEpicCarePlanRows(rowData, importImportedAtById);
    setCarePlanRows(dedupedRows);
    setLoading(false);
    return { imports: list, carePlanRows: dedupedRows, error: null };
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const uploadCarePlan = useCallback(
    async (file: File, importedBy?: string | null): Promise<CarePlanUploadResult> => {
      try {
        const buf = await file.arrayBuffer();
        const parsed = parseCarePlanXlsxBuffer(buf);
        if (parsed.errors.length) {
          return {
            error: parsed.errors.slice(0, 5).join('; '),
            importId: null,
            rowCount: 0,
            skippedDuplicates: 0,
            carePlanRows: [],
            imports: [],
          };
        }

        let existingFingerprints: Set<string>;
        try {
          existingFingerprints = await fetchCarePlanFingerprintsFromDb();
        } catch (fetchErr) {
          return {
            error:
              fetchErr instanceof Error
                ? fetchErr.message
                : 'Failed to load existing care plan rows for deduplication',
            importId: null,
            rowCount: 0,
            skippedDuplicates: 0,
            carePlanRows: [],
            imports: [],
          };
        }

        const { rows: dedupedRows, skippedDuplicates: skippedAgainstExisting } =
          dedupeCarePlanInsertRows(parsed.rows, existingFingerprints);
        const skippedDuplicates = parsed.skippedDuplicates + skippedAgainstExisting;

        if (!dedupedRows.length) {
          const refreshed = await refresh();
          return {
            error: refreshed.error,
            importId: null,
            rowCount: 0,
            skippedDuplicates,
            carePlanRows: refreshed.carePlanRows,
            imports: refreshed.imports,
          };
        }

        const importedAt = new Date().toISOString();
        const { data: importRow, error: importError } = await supabase
          .from('epic_conversion_care_plan_imports')
          .insert({
            source_filename: file.name,
            imported_at: importedAt,
            imported_by: importedBy ?? null,
            row_count: dedupedRows.length,
          })
          .select('*')
          .single();

        if (importError || !importRow) {
          return {
            error: importError?.message ?? 'Failed to save care plan import',
            importId: null,
            rowCount: 0,
            skippedDuplicates,
            carePlanRows: [],
            imports: [],
          };
        }

        const importId = (importRow as EpicCarePlanImport).id;

        for (let i = 0; i < dedupedRows.length; i += ROW_CHUNK) {
          const chunk = dedupedRows.slice(i, i + ROW_CHUNK).map((row) => toDbRow(row, importId));
          const { error: rowError } = await supabase
            .from('epic_conversion_care_plan_rows')
            .insert(chunk);

          if (rowError) {
            await supabase.from('epic_conversion_care_plan_imports').delete().eq('id', importId);
            return {
              error: rowError.message,
              importId: null,
              rowCount: 0,
              skippedDuplicates,
              carePlanRows: [],
              imports: [],
            };
          }
        }

        const refreshed = await refresh();
        return {
          error: refreshed.error,
          importId,
          rowCount: dedupedRows.length,
          skippedDuplicates,
          carePlanRows: refreshed.carePlanRows,
          imports: refreshed.imports,
        };
      } catch (err) {
        return {
          error: err instanceof Error ? err.message : 'Upload failed',
          importId: null,
          rowCount: 0,
          skippedDuplicates: 0,
          carePlanRows: [],
          imports: [],
        };
      }
    },
    [refresh]
  );

  const deleteCarePlanImport = useCallback(
    async (importId: string): Promise<{ error: string | null }> => {
      const { error: deleteError } = await supabase
        .from('epic_conversion_care_plan_imports')
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
      .from('epic_conversion_care_plan_rows')
      .select('*')
      .eq('import_id', importId)
      .order('row_index', { ascending: true });

    if (fetchError) {
      return { rows: [] as EpicCarePlanRow[], error: fetchError.message };
    }
    return { rows: (data as EpicCarePlanRow[]) ?? [], error: null };
  }, []);

  return {
    imports,
    carePlanRows,
    loading,
    error,
    refresh,
    uploadCarePlan,
    deleteCarePlanImport,
    fetchRowsForImport,
  };
}

function toDbRow(row: CarePlanInsertRow, importId: string) {
  return {
    import_id: importId,
    brn: row.brn,
    client_id: row.client_id,
    offer_id: row.offer_id,
    goldcare_id: row.goldcare_id,
    patient_name: row.patient_name,
    client_needs_goals: row.client_needs_goals,
    service_teaching_plan: row.service_teaching_plan,
    outcomes: row.outcomes,
    goal_met: row.goal_met,
    date_saved: row.date_saved,
    row_index: row.row_index,
  };
}
