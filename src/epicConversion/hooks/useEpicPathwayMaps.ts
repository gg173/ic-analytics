import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import {
  buildEpicPathwayLookup,
  setRuntimeEpicEpisodeToVhaPathway,
} from '../reconciliation/epicPathwayMap';

export interface EpicPathwayNameMapRow {
  id: string;
  epic_episode_label: string;
  vha_pathway_code: string;
  active: boolean;
  created_at: string;
}

export function useEpicPathwayMaps() {
  const [rows, setRows] = useState<EpicPathwayNameMapRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: fetchError } = await supabase
      .from('epic_pathway_name_map')
      .select('*')
      .order('epic_episode_label');

    if (fetchError) {
      setError(fetchError.message);
      setLoading(false);
      return;
    }

    const list = (data as EpicPathwayNameMapRow[]) ?? [];
    setRows(list);
    setRuntimeEpicEpisodeToVhaPathway(buildEpicPathwayLookup(list));
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { rows, loading, error, refresh };
}
