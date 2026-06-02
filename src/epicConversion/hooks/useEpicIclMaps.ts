import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import {
  buildEpicIclLookup,
  setRuntimeEpicIclToVhaIcl,
} from '../reconciliation/epicIclMap';

export interface EpicIclNameMapRow {
  id: string;
  epic_icl_label: string;
  vha_icl_label: string;
  active: boolean;
  created_at: string;
}

export function useEpicIclMaps() {
  const [rows, setRows] = useState<EpicIclNameMapRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: fetchError } = await supabase
      .from('epic_icl_name_map')
      .select('*')
      .order('epic_icl_label');

    if (fetchError) {
      setError(fetchError.message);
      setLoading(false);
      return;
    }

    const list = (data as EpicIclNameMapRow[]) ?? [];
    setRows(list);
    setRuntimeEpicIclToVhaIcl(buildEpicIclLookup(list));
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { rows, loading, error, refresh };
}
