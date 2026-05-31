import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { BatchUploader, ImportBatch } from '../types';

function uploaderLabel(uploader: BatchUploader | null | undefined): string {
  if (!uploader) return 'Unknown';
  return uploader.display_name?.trim() || uploader.email?.trim() || 'Unknown';
}

async function attachUploaders(batches: ImportBatch[]): Promise<ImportBatch[]> {
  const uploaderIds = [
    ...new Set(batches.map((b) => b.uploaded_by).filter((id): id is string => !!id)),
  ];
  if (!uploaderIds.length) return batches;

  const { data: profiles } = await supabase
    .from('profiles')
    .select('user_id, display_name, email')
    .in('user_id', uploaderIds);

  const byUserId = new Map(
    (profiles ?? [])
      .filter((p) => p.user_id)
      .map((p) => [
        p.user_id as string,
        { display_name: p.display_name, email: p.email } satisfies BatchUploader,
      ])
  );

  return batches.map((b) => ({
    ...b,
    uploader: b.uploaded_by ? (byUserId.get(b.uploaded_by) ?? null) : null,
  }));
}

export function useBatches() {
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data, error: err } = await supabase
      .from('import_batches')
      .select('*')
      .order('uploaded_at', { ascending: false });

    const rows = (data as ImportBatch[]) ?? [];
    setBatches(err ? rows : await attachUploaders(rows));
    setError(err?.message ?? null);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { batches, loading, error, refresh };
}

export async function deleteImportBatch(batch: ImportBatch): Promise<{ error: string | null }> {
  const { error: rpcError } = await supabase.rpc('delete_import_batch', {
    p_batch_id: batch.id,
  });

  if (rpcError) {
    return { error: rpcError.message };
  }

  if (batch.storage_path) {
    const { error: storageError } = await supabase.storage
      .from('homecare-imports')
      .remove([batch.storage_path]);

    if (storageError) {
      return {
        error: `Batch data removed, but the stored CSV could not be deleted: ${storageError.message}`,
      };
    }
  }

  return { error: null };
}

export { uploaderLabel };

export function useBatch(batchId: string | undefined) {
  const [batch, setBatch] = useState<ImportBatch | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!batchId) return;
    setLoading(true);
    const { data, error: err } = await supabase
      .from('import_batches')
      .select('*')
      .eq('id', batchId)
      .maybeSingle();

    setBatch(data as ImportBatch | null);
    setError(err?.message ?? null);
    setLoading(false);
  }, [batchId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const updateStatus = useCallback(
    async (status: ImportBatch['status']) => {
      if (!batchId) return { error: 'No batch' };
      const { error: err } = await supabase
        .from('import_batches')
        .update({ status })
        .eq('id', batchId);
      if (!err) await refresh();
      return { error: err?.message ?? null };
    },
    [batchId, refresh]
  );

  return { batch, loading, error, refresh, updateStatus };
}
