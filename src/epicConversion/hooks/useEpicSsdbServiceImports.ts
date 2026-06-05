import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { fetchAllSupabaseRows } from './fetchAllSupabaseRows';
import { parseVhaSsdbServiceXlsxBuffer } from '../ingest/parseVhaSsdbServiceXlsx';
import { applySsdbServiceIngest } from '../serviceData/applySsdbServiceIngest';
import {
  ssdbServiceRowHasCancellation,
  ssdbServiceRowHasChangeDetected,
  type PatientSsdbServiceFetchRow,
} from '../serviceData/linkServiceDayCarePlans';
import type { EpicSsdbService, EpicSsdbServiceImport } from '../serviceData/types';
import type { EpicConversionRecord } from '../types';

const ENROLL_ID_LOOKUP_CHUNK = 500;

function getWeekStartIso(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  const daysFromMonday = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - daysFromMonday);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export interface SsdbServiceUploadResult {
  error: string | null;
  message: string | null;
  importId: string | null;
  rowCount: number;
  newCount: number;
  updatedCount: number;
  unchangedCount: number;
  cancelledCount: number;
  skippedCount: number;
  imports: EpicSsdbServiceImport[];
}

function formatIngestMessage(
  summary: Pick<
    SsdbServiceUploadResult,
    'newCount' | 'updatedCount' | 'unchangedCount' | 'cancelledCount' | 'skippedCount'
  >
): string {
  const parts: string[] = [];
  if (summary.newCount > 0) {
    parts.push(`${summary.newCount} new`);
  }
  if (summary.updatedCount > 0) {
    parts.push(`${summary.updatedCount} updated`);
  }
  if (summary.unchangedCount > 0) {
    parts.push(`${summary.unchangedCount} unchanged`);
  }
  if (summary.cancelledCount > 0) {
    parts.push(`${summary.cancelledCount} VHA cancelled`);
  }
  if (summary.skippedCount > 0) {
    parts.push(`${summary.skippedCount} skipped`);
  }
  return parts.length ? parts.join(', ') : 'No service rows processed';
}

export function useEpicSsdbServiceImports() {
  const [imports, setImports] = useState<EpicSsdbServiceImport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<{
    imports: EpicSsdbServiceImport[];
    error: string | null;
  }> => {
    setLoading(true);
    setError(null);

    const { data, error: fetchError } = await supabase
      .from('epic_conversion_ssdb_service_imports')
      .select('*')
      .order('imported_at', { ascending: false });

    if (fetchError) {
      setError(fetchError.message);
      setImports([]);
      setLoading(false);
      return { imports: [], error: fetchError.message };
    }

    const list = (data as EpicSsdbServiceImport[]) ?? [];
    setImports(list);
    setLoading(false);
    return { imports: list, error: null };
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const uploadServiceData = useCallback(
    async (file: File, importedBy?: string | null): Promise<SsdbServiceUploadResult> => {
      const emptyResult = (
        overrides: Partial<SsdbServiceUploadResult> = {}
      ): SsdbServiceUploadResult => ({
        error: null,
        message: null,
        importId: null,
        rowCount: 0,
        newCount: 0,
        updatedCount: 0,
        unchangedCount: 0,
        cancelledCount: 0,
        skippedCount: 0,
        imports: [],
        ...overrides,
      });

      try {
        const buf = await file.arrayBuffer();
        const parsed = parseVhaSsdbServiceXlsxBuffer(buf);
        if (parsed.errors.length) {
          return emptyResult({
            error: parsed.errors.slice(0, 5).join('; '),
          });
        }

        const enrollIdsInFile = [
          ...new Set(parsed.rows.map((row) => row.enroll_id).filter(Boolean)),
        ];
        const enrolmentRecordIdByEnrollId = new Map<string, string>();

        for (let i = 0; i < enrollIdsInFile.length; i += ENROLL_ID_LOOKUP_CHUNK) {
          const batch = enrollIdsInFile.slice(i, i + ENROLL_ID_LOOKUP_CHUNK);
          const { data: recordData, error: recordsError } = await supabase
            .from('epic_conversion_records')
            .select('id, enroll_id')
            .in('enroll_id', batch);

          if (recordsError) {
            return emptyResult({ error: recordsError.message });
          }

          for (const record of (recordData as Pick<EpicConversionRecord, 'id' | 'enroll_id'>[]) ?? []) {
            if (!record.enroll_id) continue;
            if (!enrolmentRecordIdByEnrollId.has(record.enroll_id)) {
              enrolmentRecordIdByEnrollId.set(record.enroll_id, record.id);
            }
          }
        }

        const importedAt = new Date().toISOString();
        const { data: importRow, error: importError } = await supabase
          .from('epic_conversion_ssdb_service_imports')
          .insert({
            source_filename: file.name,
            imported_at: importedAt,
            imported_by: importedBy ?? null,
            row_count: parsed.rows.length,
            new_count: 0,
            updated_count: 0,
            unchanged_count: 0,
            cancelled_count: 0,
            skipped_count: 0,
          })
          .select('*')
          .single();

        if (importError || !importRow) {
          return emptyResult({
            error: importError?.message ?? 'Failed to save service data import',
          });
        }

        const importId = (importRow as EpicSsdbServiceImport).id;

        const { summary, error: ingestError } = await applySsdbServiceIngest({
          client: supabase,
          importId,
          parsedRows: parsed.rows,
          parseSkipped: parsed.skipped,
          enrolmentRecordIdByEnrollId,
        });

        if (ingestError) {
          await supabase.from('epic_conversion_ssdb_service_imports').delete().eq('id', importId);
          return emptyResult({ error: ingestError });
        }

        const { error: importUpdateError } = await supabase
          .from('epic_conversion_ssdb_service_imports')
          .update({
            new_count: summary.newCount,
            updated_count: summary.updatedCount,
            unchanged_count: summary.unchangedCount,
            cancelled_count: summary.cancelledCount,
            skipped_count: summary.skippedCount,
          })
          .eq('id', importId);

        if (importUpdateError) {
          return emptyResult({ error: importUpdateError.message, importId });
        }

        const { imports: refreshedImports } = await refresh();

        return {
          error: null,
          message: formatIngestMessage(summary),
          importId,
          rowCount: parsed.rows.length,
          newCount: summary.newCount,
          updatedCount: summary.updatedCount,
          unchangedCount: summary.unchangedCount,
          cancelledCount: summary.cancelledCount,
          skippedCount: summary.skippedCount,
          imports: refreshedImports,
        };
      } catch (err) {
        return emptyResult({
          error: err instanceof Error ? err.message : 'Upload failed',
        });
      }
    },
    [refresh]
  );

  const deleteServiceImport = useCallback(
    async (importId: string): Promise<{ error: string | null }> => {
      const { error: deleteError } = await supabase
        .from('epic_conversion_ssdb_service_imports')
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
      .from('epic_conversion_ssdb_services')
      .select('*')
      .or(`first_import_id.eq.${importId},last_import_id.eq.${importId}`)
      .order('calendar_key', { ascending: true });

    if (fetchError) {
      return { rows: [] as EpicSsdbService[], error: fetchError.message };
    }
    return { rows: (data as EpicSsdbService[]) ?? [], error: null };
  }, []);

  const fetchDailyCountsForDateRange = useCallback(async (startDate: string, endDate: string) => {
    const { data, error: fetchError } = await supabase
      .from('epic_conversion_ssdb_services')
      .select(
        'calendar_key, srv_date, enroll_id, mrn, pathway, srv_discipline, srv_delivery_mode, ingest_status'
      )
      .gte('srv_date', startDate)
      .lte('srv_date', endDate)
      .not('srv_date', 'is', null);

    if (fetchError) {
      return {
        serviceCountsByDate: new Map<string, number>(),
        patientCountsByDate: new Map<string, number>(),
        weekServiceCountsByWeekStart: new Map<string, number>(),
        weekPatientCountsByWeekStart: new Map<string, number>(),
        hasChangedServiceByDate: new Map<string, boolean>(),
        hasChangedServiceByWeekStart: new Map<string, boolean>(),
        cancelledServiceCountByDate: new Map<string, number>(),
        cancelledServiceCountByWeekStart: new Map<string, number>(),
        enrollIdsByDate: new Map<string, Set<string>>(),
        enrollIdsByWeekStart: new Map<string, Set<string>>(),
        ssdbPatientByDate: new Map(),
        ssdbServiceRows: [],
        error: fetchError.message,
      };
    }

    const serviceCountsByDate = new Map<string, number>();
    const hasChangedServiceByDate = new Map<string, boolean>();
    const hasChangedServiceByWeekStart = new Map<string, boolean>();
    const cancelledServiceCountByDate = new Map<string, number>();
    const cancelledServiceCountByWeekStart = new Map<string, number>();
    const ssdbServiceRows: Pick<
      EpicSsdbService,
      | 'calendar_key'
      | 'srv_date'
      | 'enroll_id'
      | 'mrn'
      | 'pathway'
      | 'srv_discipline'
      | 'srv_delivery_mode'
      | 'ingest_status'
    >[] = [];
    const enrollIdsByDate = new Map<string, Set<string>>();
    const ssdbPatientByDate = new Map<
      string,
      Map<string, { mrn: string | null; pathway: string | null }>
    >();
    const calendarKeysByWeekStart = new Map<string, Set<string>>();
    const enrollIdsByWeekStart = new Map<string, Set<string>>();

    for (const row of (
      data as Pick<
        EpicSsdbService,
        | 'calendar_key'
        | 'srv_date'
        | 'enroll_id'
        | 'mrn'
        | 'pathway'
        | 'srv_discipline'
        | 'srv_delivery_mode'
        | 'ingest_status'
      >[]
    ) ?? []) {
      if (!row.srv_date) continue;
      ssdbServiceRows.push(row);
      serviceCountsByDate.set(row.srv_date, (serviceCountsByDate.get(row.srv_date) ?? 0) + 1);
      if (ssdbServiceRowHasChangeDetected(row)) {
        hasChangedServiceByDate.set(row.srv_date, true);
      }
      if (ssdbServiceRowHasCancellation(row)) {
        cancelledServiceCountByDate.set(
          row.srv_date,
          (cancelledServiceCountByDate.get(row.srv_date) ?? 0) + 1
        );
      }
      if (row.enroll_id) {
        const enrollIds = enrollIdsByDate.get(row.srv_date) ?? new Set<string>();
        enrollIds.add(row.enroll_id);
        enrollIdsByDate.set(row.srv_date, enrollIds);

        const patientsOnDate = ssdbPatientByDate.get(row.srv_date) ?? new Map();
        if (!patientsOnDate.has(row.enroll_id)) {
          patientsOnDate.set(row.enroll_id, {
            mrn: row.mrn?.trim() || null,
            pathway: row.pathway?.trim() || null,
          });
        }
        ssdbPatientByDate.set(row.srv_date, patientsOnDate);
      }

      const weekStart = getWeekStartIso(row.srv_date);
      if (ssdbServiceRowHasChangeDetected(row)) {
        hasChangedServiceByWeekStart.set(weekStart, true);
      }
      if (ssdbServiceRowHasCancellation(row)) {
        cancelledServiceCountByWeekStart.set(
          weekStart,
          (cancelledServiceCountByWeekStart.get(weekStart) ?? 0) + 1
        );
      }
      if (row.calendar_key) {
        const calendarKeys = calendarKeysByWeekStart.get(weekStart) ?? new Set<string>();
        calendarKeys.add(row.calendar_key);
        calendarKeysByWeekStart.set(weekStart, calendarKeys);
      }
      if (row.enroll_id) {
        const enrollIds = enrollIdsByWeekStart.get(weekStart) ?? new Set<string>();
        enrollIds.add(row.enroll_id);
        enrollIdsByWeekStart.set(weekStart, enrollIds);
      }
    }

    const patientCountsByDate = new Map<string, number>();
    for (const [date, enrollIds] of enrollIdsByDate) {
      patientCountsByDate.set(date, enrollIds.size);
    }

    const weekServiceCountsByWeekStart = new Map<string, number>();
    for (const [weekStart, calendarKeys] of calendarKeysByWeekStart) {
      weekServiceCountsByWeekStart.set(weekStart, calendarKeys.size);
    }

    const weekPatientCountsByWeekStart = new Map<string, number>();
    for (const [weekStart, enrollIds] of enrollIdsByWeekStart) {
      weekPatientCountsByWeekStart.set(weekStart, enrollIds.size);
    }

    return {
      serviceCountsByDate,
      patientCountsByDate,
      weekServiceCountsByWeekStart,
      weekPatientCountsByWeekStart,
      hasChangedServiceByDate,
      hasChangedServiceByWeekStart,
      cancelledServiceCountByDate,
      cancelledServiceCountByWeekStart,
      enrollIdsByDate,
      enrollIdsByWeekStart,
      ssdbPatientByDate,
      ssdbServiceRows,
      error: null,
    };
  }, []);

  const fetchSsdbServiceDateBounds = useCallback(async () => {
    const [minResult, maxResult] = await Promise.all([
      supabase
        .from('epic_conversion_ssdb_services')
        .select('srv_date')
        .not('srv_date', 'is', null)
        .order('srv_date', { ascending: true })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('epic_conversion_ssdb_services')
        .select('srv_date')
        .not('srv_date', 'is', null)
        .order('srv_date', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const error = minResult.error?.message ?? maxResult.error?.message ?? null;
    return {
      from: minResult.data?.srv_date ?? '',
      to: maxResult.data?.srv_date ?? '',
      error,
    };
  }, []);

  const fetchVisitCountsByEnrollIdInDateRange = useCallback(
    async (startDate: string, endDate: string) => {
      if (!startDate && !endDate) {
        return { visitCountsByEnrollId: new Map<string, number>(), error: null as string | null };
      }

      const { data, error } = await fetchAllSupabaseRows<Pick<EpicSsdbService, 'enroll_id'>>(
        (client, from, to) => {
          let query = client
            .from('epic_conversion_ssdb_services')
            .select('enroll_id')
            .not('srv_date', 'is', null)
            .not('enroll_id', 'is', null);
          if (startDate) {
            query = query.gte('srv_date', startDate);
          }
          if (endDate) {
            query = query.lte('srv_date', endDate);
          }
          return query.range(from, to);
        },
        supabase
      );

      if (error) {
        return { visitCountsByEnrollId: new Map<string, number>(), error: error.message };
      }

      const visitCountsByEnrollId = new Map<string, number>();
      for (const row of data) {
        if (!row.enroll_id) continue;
        visitCountsByEnrollId.set(
          row.enroll_id,
          (visitCountsByEnrollId.get(row.enroll_id) ?? 0) + 1
        );
      }

      return { visitCountsByEnrollId, error: null };
    },
    []
  );

  const fetchPatientSsdbServicesInDateRange = useCallback(
    async (enrollId: string, startDate: string, endDate: string) => {
      const trimmedEnrollId = enrollId.trim();
      if (!trimmedEnrollId) {
        return { rows: [] as PatientSsdbServiceFetchRow[], error: null as string | null };
      }

      const { data, error: fetchError } = await supabase
        .from('epic_conversion_ssdb_services')
        .select(
          'calendar_key, srv_date, srv_date_pdd, enroll_id, mrn, pathway, carepath, srv_discipline, srv_delivery_mode, program, srv_code, srv_code_description, srv_status, srv_tx_codes, srv_provider_id, srv_provider_designation, start_time, end_time, worked_duration, ingest_status'
        )
        .eq('enroll_id', trimmedEnrollId)
        .gte('srv_date', startDate)
        .lte('srv_date', endDate)
        .not('srv_date', 'is', null)
        .order('srv_date', { ascending: true });

      if (fetchError) {
        return { rows: [] as PatientSsdbServiceFetchRow[], error: fetchError.message };
      }

      return { rows: (data as PatientSsdbServiceFetchRow[]) ?? [], error: null };
    },
    []
  );

  const fetchMonthHasServices = useCallback(async (year: number, month: number) => {
    const monthStart = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month + 1, 0).getDate();
    const monthEnd = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    const { count, error: fetchError } = await supabase
      .from('epic_conversion_ssdb_services')
      .select('*', { count: 'exact', head: true })
      .gte('srv_date', monthStart)
      .lte('srv_date', monthEnd)
      .not('srv_date', 'is', null);

    if (fetchError) {
      return { hasServices: false, error: fetchError.message };
    }

    return { hasServices: (count ?? 0) > 0, error: null };
  }, []);

  return {
    imports,
    loading,
    error,
    refresh,
    uploadServiceData,
    deleteServiceImport,
    fetchRowsForImport,
    fetchDailyCountsForDateRange,
    fetchSsdbServiceDateBounds,
    fetchVisitCountsByEnrollIdInDateRange,
    fetchPatientSsdbServicesInDateRange,
    fetchMonthHasServices,
  };
}
