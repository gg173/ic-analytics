/** Default Epic episode labels → VHA SSDB pathway codes (seeded in DB). */
export const DEFAULT_EPIC_EPISODE_TO_VHA_PATHWAY: Readonly<Record<string, string>> = {
  'UHN at Home - Gynecology-Oncology': 'UHN-GYN',
  'UHN at Home - GIM': 'UHN-GIM',
  'UHN at Home - Cardiovascular': 'UHN-CV',
  'UHN at Home - General Surgery': 'UHN-GSX',
  'UHN at Home - Vascular': 'UHN-VAS',
  'UHN at Home - Plastic surgery': 'UHN-PSX',
  'UHN at Home - Head & Neck': 'UHN-HDN',
  'UHN at Home - Urology': 'UHN-URO',
  'UHN at Home - Orthopedics': 'UHN-ORTHO',
  'UHN at Home - Cardiology': 'UHN-CRD',
  'UHN at Home - Breast': 'UHN-BRT',
  'UHN at Home - Transition': 'UHN-TRANSITION',
};

/** @deprecated Use runtime maps from EpicConversionMapsProvider. */
export const EPIC_EPISODE_TO_VHA_PATHWAY = DEFAULT_EPIC_EPISODE_TO_VHA_PATHWAY;

let runtimeEpicEpisodeToVhaPathway: Readonly<Record<string, string>> =
  DEFAULT_EPIC_EPISODE_TO_VHA_PATHWAY;

export function setRuntimeEpicEpisodeToVhaPathway(
  maps: Readonly<Record<string, string>>
): void {
  runtimeEpicEpisodeToVhaPathway = maps;
}

export function getRuntimeEpicEpisodeToVhaPathway(): Readonly<Record<string, string>> {
  return runtimeEpicEpisodeToVhaPathway;
}

export function normalizeEpicEpisodeKey(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function deleteLookupKeyCaseInsensitive(
  lookup: Record<string, string>,
  key: string
): void {
  const normalized = key.toLowerCase();
  for (const existing of Object.keys(lookup)) {
    if (existing.toLowerCase() === normalized) {
      delete lookup[existing];
    }
  }
}

export function buildEpicPathwayLookup(
  rows: { epic_episode_label: string; vha_pathway_code: string; active?: boolean }[]
): Record<string, string> {
  const lookup: Record<string, string> = { ...DEFAULT_EPIC_EPISODE_TO_VHA_PATHWAY };
  for (const row of rows) {
    const key = normalizeEpicEpisodeKey(row.epic_episode_label);
    if (!key) continue;
    if (row.active === false) {
      deleteLookupKeyCaseInsensitive(lookup, key);
      continue;
    }
    deleteLookupKeyCaseInsensitive(lookup, key);
    lookup[key] = row.vha_pathway_code.trim();
  }
  return lookup;
}

export function mapEpicEpisodeToVhaPathway(episode: string | null | undefined): string | null {
  if (!episode?.trim()) return null;
  const trimmed = normalizeEpicEpisodeKey(episode);
  const mapped = runtimeEpicEpisodeToVhaPathway[trimmed];
  if (mapped) return mapped;
  const caseInsensitive = Object.entries(runtimeEpicEpisodeToVhaPathway).find(
    ([key]) => key.toLowerCase() === trimmed.toLowerCase()
  );
  return caseInsensitive?.[1] ?? null;
}
