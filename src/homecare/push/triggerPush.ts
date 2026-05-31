import { supabase } from '../../lib/supabase';

export async function triggerPush(batchId: string, destinationId: string): Promise<{ ok: boolean; error?: string }> {
  const { data: job, error: jobError } = await supabase
    .from('push_jobs')
    .insert({ batch_id: batchId, destination_id: destinationId, status: 'pending' })
    .select('id')
    .single();

  if (jobError || !job) {
    return { ok: false, error: jobError?.message ?? 'Failed to create push job' };
  }

  const { data, error } = await supabase.functions.invoke('push-batch', {
    body: { batch_id: batchId, destination_id: destinationId, job_id: job.id },
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true, ...(data as object) };
}
