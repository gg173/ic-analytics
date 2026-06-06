import { supabase } from '../../lib/supabase';
import type { EpicConversionRecord } from '../types';
import { batchUpsertEpicConversionRecordsById } from '../ingest/batchEpicConversionWrites';
import { planEpicConvertEnrolments } from './applyEpicConvertEnrolments';
import type { EpicConversionReportRow } from './types';

const INSERT_CHUNK = 400;

export async function persistEpicConvertEnrolments(
  reportRows: EpicConversionReportRow[],
  vhaRecords: readonly EpicConversionRecord[],
  options: {
    sourceFilename: string;
    importedAt: string;
    importedBy: string | null;
  }
): Promise<{ error: string | null; provisioned: number; updated: number }> {
  const plan = planEpicConvertEnrolments(reportRows, vhaRecords, options);

  if (plan.inserts.length) {
    for (let i = 0; i < plan.inserts.length; i += INSERT_CHUNK) {
      const chunk = plan.inserts.slice(i, i + INSERT_CHUNK);
      const { error } = await supabase.from('epic_conversion_records').insert(chunk);
      if (error) {
        return { error: error.message, provisioned: 0, updated: 0 };
      }
    }
  }

  if (plan.updates.length) {
    const { error } = await batchUpsertEpicConversionRecordsById(plan.updates);
    if (error) {
      return {
        error,
        provisioned: plan.inserts.length,
        updated: 0,
      };
    }
  }

  return {
    error: null,
    provisioned: plan.inserts.length,
    updated: plan.updates.length,
  };
}
