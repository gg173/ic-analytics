import { supabase } from '../../lib/supabase';
import { buildEpicIclLookup, setRuntimeEpicIclToVhaIcl } from './epicIclMap';
import { buildEpicPathwayLookup, setRuntimeEpicEpisodeToVhaPathway } from './epicPathwayMap';

/** Reload Epic→VHA mapping tables from Supabase into module runtime lookups. */
export async function refreshRuntimeEpicConversionMaps(): Promise<{ error: string | null }> {
  const [iclRes, pathwayRes] = await Promise.all([
    supabase.from('epic_icl_name_map').select('epic_icl_label, vha_icl_label, active'),
    supabase.from('epic_pathway_name_map').select('epic_episode_label, vha_pathway_code, active'),
  ]);

  if (iclRes.error) {
    return { error: iclRes.error.message };
  }
  if (pathwayRes.error) {
    return { error: pathwayRes.error.message };
  }

  setRuntimeEpicIclToVhaIcl(buildEpicIclLookup(iclRes.data ?? []));
  setRuntimeEpicEpisodeToVhaPathway(buildEpicPathwayLookup(pathwayRes.data ?? []));
  return { error: null };
}
