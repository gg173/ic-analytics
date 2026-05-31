import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { CancellationInvestigation, ServiceVisit, VisitFilter } from '../types';

const FETCH_STEP = 1000;

export type ServiceVisitRow = ServiceVisit & {
  investigation?: Pick<CancellationInvestigation, 'outcome'> | null;
};

function mapVisitRows(data: Record<string, unknown>[] | null): ServiceVisitRow[] {
  return (data ?? []).map((row) => {
    const invRaw = row.cancellation_investigations;
    const inv = Array.isArray(invRaw) ? invRaw[0] : invRaw;
    const { cancellation_investigations: _, ...visit } = row;
    return {
      ...(visit as unknown as ServiceVisit),
      investigation: (inv as Pick<CancellationInvestigation, 'outcome'> | null) ?? null,
    };
  });
}

export function useVisits(batchId: string | undefined, filter: VisitFilter = 'all') {
  const [visits, setVisits] = useState<ServiceVisitRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!batchId) return;
    setLoading(true);

    const all: ServiceVisitRow[] = [];
    let from = 0;
    let fetchError: string | null = null;

    while (true) {
      let query = supabase
        .from('service_visits')
        .select('*, cancellation_investigations(outcome)')
        .eq('batch_id', batchId)
        .order('import_row_number', { ascending: true })
        .range(from, from + FETCH_STEP - 1);

      if (filter === 'virtual_approval') query = query.eq('needs_virtual_approval', true);
      else if (filter === 'over_limit') query = query.eq('needs_limit_approval', true);
      else if (filter === 'cancellations') query = query.eq('needs_cancellation_investigation', true);
      else if (filter === 'ready') {
        query = query
          .eq('is_billable', true)
          .eq('needs_virtual_approval', false)
          .eq('needs_limit_approval', false)
          .eq('needs_cancellation_investigation', false);
      } else if (filter === 'issues') {
        query = query.or(
          'has_quality_issue.eq.true,needs_virtual_approval.eq.true,needs_limit_approval.eq.true,needs_cancellation_investigation.eq.true'
        );
      } else if (filter === 'duration' || filter === 'title_discipline') {
        query = query.eq('has_quality_issue', true);
      }

      const { data, error: err } = await query;
      if (err) {
        fetchError = err.message;
        break;
      }
      if (!data?.length) break;
      all.push(...mapVisitRows(data as Record<string, unknown>[]));
      if (data.length < FETCH_STEP) break;
      from += FETCH_STEP;
    }

    setVisits(all);
    setError(fetchError);
    setLoading(false);
  }, [batchId, filter]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const updateVisit = useCallback(
    async (visitId: string, updates: Partial<ServiceVisit>) => {
      const { error: err } = await supabase.from('service_visits').update(updates).eq('id', visitId);
      if (!err) await refresh();
      return { error: err?.message ?? null };
    },
    [refresh]
  );

  return { visits, loading, error, refresh, updateVisit };
}

export function useAllVisitsForExport(batchId: string | undefined) {
  const [visits, setVisits] = useState<ServiceVisit[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchAll = useCallback(async () => {
    if (!batchId) return [];
    setLoading(true);
    const all: ServiceVisit[] = [];
    let from = 0;
    while (true) {
      const { data } = await supabase
        .from('service_visits')
        .select('*')
        .eq('batch_id', batchId)
        .order('import_row_number')
        .range(from, from + FETCH_STEP - 1);
      if (!data?.length) break;
      all.push(...(data as ServiceVisit[]));
      if (data.length < FETCH_STEP) break;
      from += FETCH_STEP;
    }
    setVisits(all);
    setLoading(false);
    return all;
  }, [batchId]);

  return { visits, loading, fetchAll };
}
