import { supabase } from '../../lib/supabase';

export const RECORD_WRITE_CHUNK = 400;

/** Upsert by primary key; only columns present in each payload are written. */
export async function batchUpsertEpicConversionRecordsById(
  payloads: Record<string, unknown>[]
): Promise<{ error: string | null }> {
  if (!payloads.length) return { error: null };

  for (let i = 0; i < payloads.length; i += RECORD_WRITE_CHUNK) {
    const batch = payloads.slice(i, i + RECORD_WRITE_CHUNK);
    const { error } = await supabase
      .from('epic_conversion_records')
      .upsert(batch, { onConflict: 'id' });
    if (error) return { error: error.message };
  }

  return { error: null };
}
