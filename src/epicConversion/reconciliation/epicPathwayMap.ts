/** Epic "Episode" labels from conversion exports → VHA SSDB pathway codes. */
export const EPIC_EPISODE_TO_VHA_PATHWAY: Readonly<Record<string, string>> = {
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

export function mapEpicEpisodeToVhaPathway(episode: string | null | undefined): string | null {
  if (!episode?.trim()) return null;
  const trimmed = episode.trim();
  const mapped = EPIC_EPISODE_TO_VHA_PATHWAY[trimmed];
  if (mapped) return mapped;
  const caseInsensitive = Object.entries(EPIC_EPISODE_TO_VHA_PATHWAY).find(
    ([key]) => key.toLowerCase() === trimmed.toLowerCase()
  );
  return caseInsensitive?.[1] ?? null;
}
