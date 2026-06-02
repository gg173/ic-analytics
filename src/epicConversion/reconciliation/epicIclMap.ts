/** Default Epic → VHA SSDB ic_lead mappings (seeded in DB; kept for offline / first paint). */
export const DEFAULT_EPIC_ICL_TO_VHA_ICL: Readonly<Record<string, string>> = {
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
  'ZHANG CHUNG, DAN': 'ZHANG CHUNG (UHN), MIGUEL A. (#18891)',
};

/** @deprecated Use runtime maps from EpicConversionMapsProvider; kept for tests importing the constant name. */
export const EPIC_ICL_TO_VHA_ICL = DEFAULT_EPIC_ICL_TO_VHA_ICL;

let runtimeEpicIclToVhaIcl: Readonly<Record<string, string>> = DEFAULT_EPIC_ICL_TO_VHA_ICL;

export function setRuntimeEpicIclToVhaIcl(maps: Readonly<Record<string, string>>): void {
  runtimeEpicIclToVhaIcl = maps;
}

export function getRuntimeEpicIclToVhaIcl(): Readonly<Record<string, string>> {
  return runtimeEpicIclToVhaIcl;
}

export function normalizeEpicIclKey(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toUpperCase();
}

export function buildEpicIclLookup(
  rows: { epic_icl_label: string; vha_icl_label: string; active?: boolean }[]
): Record<string, string> {
  const lookup: Record<string, string> = { ...DEFAULT_EPIC_ICL_TO_VHA_ICL };
  for (const row of rows) {
    const key = normalizeEpicIclKey(row.epic_icl_label);
    if (!key) continue;
    if (row.active === false) {
      delete lookup[key];
      continue;
    }
    lookup[key] = row.vha_icl_label.trim();
  }
  return lookup;
}

export function mapEpicIclToVhaIcl(epicIcl: string | null | undefined): string | null {
  if (!epicIcl?.trim()) return null;
  const key = normalizeEpicIclKey(epicIcl);
  const mapped = runtimeEpicIclToVhaIcl[key];
  if (mapped) return mapped;
  const caseInsensitive = Object.entries(runtimeEpicIclToVhaIcl).find(
    ([label]) => normalizeEpicIclKey(label) === key
  );
  return caseInsensitive?.[1] ?? null;
}
