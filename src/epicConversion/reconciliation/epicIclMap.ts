/** Epic case team column labels ("Patient's Case Team Members", legacy "ICL/HCS Assigned") → VHA SSDB ic_lead strings. */
export const EPIC_ICL_TO_VHA_ICL: Readonly<Record<string, string>> = {
  'MANALO, HERSHEY': 'MANALO (UHN), HERSHEY (#17725)',
  'LOCQUIAO, JHIFFEE': 'LOCQUIAO (UHN), JHIFFEE (#15522)',
  'JURAS, AL VINCENT': 'JURAS (UHN), AL VINCENT (#17726)',
  'JURAS, ALVINCENT': 'JURAS (UHN), AL VINCENT (#17726)',
  'WYSS, LARA': 'WYSS (UHN), LARA (#16480)',
  'FODERINGHAM, DONNETTE': 'FODERINGHAM (UHN), DONNETTE (#17538)',
  'SHARMA, NIDHI': 'SHARMA (UHN), NIDHI (#21191)',
  'VALI, NEGAR': 'VALI (UHN), NEGAR (#19152)',
  'BINKOWSKI, EWA': 'BINKOWSKI (UHN), EWA (#17106)',
  'VIPULANANTHARAJAH, VIRROSA': 'VIPULANANTHARAJAH (UHN), VIRROSA (#18123)',
  'TAYLOR, MATTHEW': 'TAYLOR (UHN), MATTHEW (#17724)',
  'KWON, CAROL': 'KWON (UHN), CAROL (#19851)',
  'NIKAHWAL, SARAH': 'NIKAHWAL (UHN), SARAH (#16897)',
  'RIRAO, RICHARD': 'RIRAO (UHN), RICHARD (#14690)',
};

function normalizeEpicIclKey(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toUpperCase();
}

export function mapEpicIclToVhaIcl(epicIcl: string | null | undefined): string | null {
  if (!epicIcl?.trim()) return null;
  const key = normalizeEpicIclKey(epicIcl);
  const mapped = EPIC_ICL_TO_VHA_ICL[key];
  if (mapped) return mapped;
  const caseInsensitive = Object.entries(EPIC_ICL_TO_VHA_ICL).find(
    ([label]) => normalizeEpicIclKey(label) === key
  );
  return caseInsensitive?.[1] ?? null;
}
