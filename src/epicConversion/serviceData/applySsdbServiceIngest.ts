import type { SupabaseClient } from '@supabase/supabase-js';
import {
  parsedRowToDbInsert,
  parsedRowToDbUpdate,
  serviceRowsMatchForIngest,
} from '../ingest/transformVhaSsdbService';
import type {
  EpicSsdbService,
  SsdbServiceIngestSummary,
  SsdbServiceParsedRow,
} from './types';

const LOOKUP_CHUNK = 500;
const WRITE_CHUNK = 400;

type ExistingServiceRow = Pick<
  EpicSsdbService,
  'id' | 'calendar_key' | 'first_import_id' | 'srv_date' | 'srv_tx_codes' | 'srv_provider_id'
>;

export interface ApplySsdbServiceIngestInput {
  client: SupabaseClient;
  importId: string;
  parsedRows: SsdbServiceParsedRow[];
  parseSkipped: number;
  enrolmentRecordIdByEnrollId: Map<string, string>;
}

export async function applySsdbServiceIngest({
  client,
  importId,
  parsedRows,
  parseSkipped,
  enrolmentRecordIdByEnrollId,
}: ApplySsdbServiceIngestInput): Promise<
  { summary: SsdbServiceIngestSummary; error: string | null }
> {
  const summary: SsdbServiceIngestSummary = {
    newCount: 0,
    updatedCount: 0,
    unchangedCount: 0,
    cancelledCount: 0,
    skippedCount: parseSkipped,
  };

  const calendarKeys = parsedRows.map((row) => row.calendar_key);
  const existingByCalendarKey = new Map<string, ExistingServiceRow>();

  for (let i = 0; i < calendarKeys.length; i += LOOKUP_CHUNK) {
    const batch = calendarKeys.slice(i, i + LOOKUP_CHUNK);
    const { data, error } = await client
      .from('epic_conversion_ssdb_services')
      .select('id, calendar_key, first_import_id, srv_date, srv_tx_codes, srv_provider_id')
      .in('calendar_key', batch);

    if (error) return { summary, error: error.message };
    for (const row of (data as ExistingServiceRow[]) ?? []) {
      existingByCalendarKey.set(row.calendar_key, row);
    }
  }

  const enrollIdsInFile = new Set<string>();
  const calendarKeysByEnrollId = new Map<string, Set<string>>();
  const toWrite: Record<string, unknown>[] = [];

  for (const row of parsedRows) {
    enrollIdsInFile.add(row.enroll_id);
    const keys = calendarKeysByEnrollId.get(row.enroll_id) ?? new Set<string>();
    keys.add(row.calendar_key);
    calendarKeysByEnrollId.set(row.enroll_id, keys);

    const enrolmentRecordId = enrolmentRecordIdByEnrollId.get(row.enroll_id) ?? null;
    if (!enrolmentRecordId) {
      summary.skippedCount += 1;
      continue;
    }

    const existing = existingByCalendarKey.get(row.calendar_key);
    if (!existing) {
      toWrite.push(parsedRowToDbInsert(row, enrolmentRecordId, importId, 'active'));
      summary.newCount += 1;
      continue;
    }

    if (serviceRowsMatchForIngest(existing, row)) {
      summary.unchangedCount += 1;
      continue;
    }

    toWrite.push({
      ...parsedRowToDbUpdate(row, enrolmentRecordId, importId),
      calendar_key: row.calendar_key,
      first_import_id: existing.first_import_id ?? importId,
    });
    summary.updatedCount += 1;
  }

  for (let i = 0; i < toWrite.length; i += WRITE_CHUNK) {
    const batch = toWrite.slice(i, i + WRITE_CHUNK);
    const { error: writeError } = await client
      .from('epic_conversion_ssdb_services')
      .upsert(batch, { onConflict: 'calendar_key' });
    if (writeError) return { summary, error: writeError.message };
  }

  const enrollIdList = [...enrollIdsInFile];
  for (let i = 0; i < enrollIdList.length; i += LOOKUP_CHUNK) {
    const batch = enrollIdList.slice(i, i + LOOKUP_CHUNK);
    const { data, error } = await client
      .from('epic_conversion_ssdb_services')
      .select('id, calendar_key, enroll_id, ingest_status')
      .in('enroll_id', batch)
      .in('ingest_status', ['active', 'changed']);

    if (error) return { summary, error: error.message };

    const toCancel: string[] = [];
    for (const service of (data as Pick<EpicSsdbService, 'id' | 'calendar_key' | 'enroll_id' | 'ingest_status'>[]) ??
      []) {
      if (!enrollIdsInFile.has(service.enroll_id)) continue;
      const keysForEnroll = calendarKeysByEnrollId.get(service.enroll_id);
      if (!keysForEnroll?.has(service.calendar_key)) {
        toCancel.push(service.id);
      }
    }

    for (let j = 0; j < toCancel.length; j += WRITE_CHUNK) {
      const cancelBatch = toCancel.slice(j, j + WRITE_CHUNK);
      const { error: cancelError } = await client
        .from('epic_conversion_ssdb_services')
        .update({
          ingest_status: 'vha_cancelled',
          last_import_id: importId,
        })
        .in('id', cancelBatch);
      if (cancelError) return { summary, error: cancelError.message };
      summary.cancelledCount += cancelBatch.length;
    }
  }

  return { summary, error: null };
}
