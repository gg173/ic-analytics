import { supabase } from '../../lib/supabase';
import type { MappedHomecareRow } from '../types';

export async function importBatchWithVisits(
  filename: string,
  visits: MappedHomecareRow[],
  userId: string,
  storagePath?: string
): Promise<{ batchId: string | null; error: string | null }> {
  const { data: batch, error: batchError } = await supabase
    .from('import_batches')
    .insert({
      filename,
      uploaded_by: userId,
      status: 'draft',
      storage_path: storagePath ?? null,
    })
    .select('id')
    .single();

  if (batchError || !batch) {
    return { batchId: null, error: batchError?.message ?? 'Failed to create batch' };
  }

  const batchId = batch.id as string;
  const chunkSize = 200;

  for (let i = 0; i < visits.length; i += chunkSize) {
    const chunk = visits.slice(i, i + chunkSize);
    const { error: importError } = await supabase.rpc('import_service_visits', {
      p_batch_id: batchId,
      p_visits: chunk,
    });
    if (importError) {
      return { batchId, error: importError.message };
    }
  }

  await supabase
    .from('import_batches')
    .update({ row_count: visits.length, updated_at: new Date().toISOString() })
    .eq('id', batchId);

  return { batchId, error: null };
}
