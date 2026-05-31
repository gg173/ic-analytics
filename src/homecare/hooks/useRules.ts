import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import type {
  CareStream,
  RuleTitleDiscipline,
  RuleVirtualVisitApproval,
  RuleVisitStatusBillable,
  RuleCancellationReason,
  RuleDurationBounds,
  PushDestination,
} from '../types';

export function useRules() {
  const [careStreams, setCareStreams] = useState<CareStream[]>([]);
  const [titleDiscipline, setTitleDiscipline] = useState<RuleTitleDiscipline[]>([]);
  const [virtualVisit, setVirtualVisit] = useState<RuleVirtualVisitApproval[]>([]);
  const [statusBillable, setStatusBillable] = useState<RuleVisitStatusBillable[]>([]);
  const [cancellationReasons, setCancellationReasons] = useState<RuleCancellationReason[]>([]);
  const [durationBounds, setDurationBounds] = useState<RuleDurationBounds | null>(null);
  const [pushDestinations, setPushDestinations] = useState<PushDestination[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [cs, td, vv, sb, cr, db, pd] = await Promise.all([
      supabase.from('care_streams').select('*').order('name'),
      supabase.from('rule_title_discipline_map').select('*').order('employee_title'),
      supabase.from('rule_virtual_visit_approval').select('*').order('employee_discipline'),
      supabase.from('rule_visit_status_billable').select('*').order('status_of_visit'),
      supabase.from('rule_cancellation_reasons').select('*').order('reason_code'),
      supabase.from('rule_duration_bounds').select('*').eq('active', true).limit(1).maybeSingle(),
      supabase.from('push_destinations').select('*').order('name'),
    ]);

    setCareStreams((cs.data as CareStream[]) ?? []);
    setTitleDiscipline((td.data as RuleTitleDiscipline[]) ?? []);
    setVirtualVisit((vv.data as RuleVirtualVisitApproval[]) ?? []);
    setStatusBillable((sb.data as RuleVisitStatusBillable[]) ?? []);
    setCancellationReasons((cr.data as RuleCancellationReason[]) ?? []);
    setDurationBounds(
      (db.data as RuleDurationBounds) ?? {
        id: '',
        min_minutes: 15,
        max_minutes: 75,
        active: true,
      }
    );
    setPushDestinations((pd.data as PushDestination[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    careStreams,
    titleDiscipline,
    virtualVisit,
    statusBillable,
    cancellationReasons,
    durationBounds,
    pushDestinations,
    loading,
    refresh,
  };
}

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

  const { error: validateError } = await supabase.rpc('validate_batch', {
    p_batch_id: batchId,
  });

  if (validateError) {
    return { batchId, error: validateError.message };
  }

  return { batchId, error: null };
}

export async function revalidateBatch(batchId: string): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('validate_batch', { p_batch_id: batchId });
  return { error: error?.message ?? null };
}
