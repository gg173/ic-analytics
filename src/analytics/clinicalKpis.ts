import type {
  ClinicalSiteGroup,
  MergedClinicalRow,
  MonthlyClinicalRollup,
  PathwayMetricSlice,
} from '../data/types';
import { isMrnHospDcDateMatch, recodeHospitalSiteString } from './merge';
import { formatMonthLabel, monthKey, startOfMonth } from './dates';

const SITE_ORDER: Record<ClinicalSiteGroup, number> = {
  TG: 0,
  TW: 1,
  'TG+TW': 2,
  Other: 3,
};

/** Map Flowsheet hospital site to TG / TW / Other. */
export function siteGroupFromHospitalSite(
  hospitalSite: string | null
): ClinicalSiteGroup {
  if (!hospitalSite?.trim()) return 'Other';
  const normalized = recodeHospitalSiteString(hospitalSite);
  const s = normalized.trim().toLowerCase();
  if (
    s === 'toronto general hospital' ||
    s === 'tgh' ||
    (s.includes('toronto') && s.includes('general'))
  ) {
    return 'TG';
  }
  if (
    s === 'toronto western hospital' ||
    s === 'twh' ||
    (s.includes('toronto') && s.includes('western'))
  ) {
    return 'TW';
  }
  return 'Other';
}

function normalizeCarePathKey(raw: string): string {
  const t = raw.trim();
  return t.length ? t : '(blank)';
}

function groupKey(carePath: string, site: ClinicalSiteGroup): string {
  return JSON.stringify([carePath, site]);
}

function buildMetricSlice(
  carePath: string,
  site: ClinicalSiteGroup,
  inPath: MergedClinicalRow[]
): PathwayMetricSlice {
  const volume = inPath.length;
  let contact24Numerator = 0;
  let weekendNumerator = 0;
  let sumSupport = 0;
  let sumCheckIn = 0;
  for (const r of inPath) {
    if (r.contactIn24h === true) contact24Numerator += 1;
    if (r.weekendDc === true) weekendNumerator += 1;
    sumSupport += r.supportLineCalls;
    sumCheckIn += r.scheduledCheckInCalls;
  }
  const contact24Pct =
    volume > 0 ? (100 * contact24Numerator) / volume : null;
  const weekendPct = volume > 0 ? (100 * weekendNumerator) / volume : null;
  const avgSupportLinePerPt = volume > 0 ? sumSupport / volume : null;
  const avgCheckInPerPt = volume > 0 ? sumCheckIn / volume : null;
  return {
    pathwayId: groupKey(carePath, site),
    carePath,
    site,
    volume,
    contact24Numerator,
    contact24Pct,
    weekendNumerator,
    weekendPct,
    avgSupportLinePerPt,
    avgCheckInPerPt,
  };
}

function buildSlicesForMonth(rows: MergedClinicalRow[]): PathwayMetricSlice[] {
  const byKey = new Map<string, MergedClinicalRow[]>();
  for (const r of rows) {
    const carePath = normalizeCarePathKey(r.carePath);
    const site = siteGroupFromHospitalSite(r.hospitalSite);
    const key = groupKey(carePath, site);
    const list = byKey.get(key) ?? [];
    list.push(r);
    byKey.set(key, list);
  }

  const entries = [...byKey.entries()].sort(([ka], [kb]) => {
    const [pa, sa] = JSON.parse(ka) as [string, ClinicalSiteGroup];
    const [pb, sb] = JSON.parse(kb) as [string, ClinicalSiteGroup];
    const c = pa.localeCompare(pb, undefined, { sensitivity: 'base' });
    if (c !== 0) return c;
    return SITE_ORDER[sa] - SITE_ORDER[sb];
  });

  return entries.map(([key, inPath]) => {
    const [carePath, site] = JSON.parse(key) as [string, ClinicalSiteGroup];
    return buildMetricSlice(carePath, site, inPath);
  });
}

export function buildClinicalRollups(
  merged: MergedClinicalRow[]
): MonthlyClinicalRollup[] {
  /** Linked cohort only; month = VHA hospital DC month (matches linkage criterion). */
  const linkedWithDcMonth: MergedClinicalRow[] = [];
  for (const r of merged) {
    if (!isMrnHospDcDateMatch(r) || !r.hospDcDate) continue;
    const mb = startOfMonth(r.hospDcDate);
    linkedWithDcMonth.push({
      ...r,
      monthBucket: mb,
    });
  }

  const monthsMap = new Map<string, Date>();
  for (const r of linkedWithDcMonth) {
    if (!r.monthBucket) continue;
    const mk = monthKey(r.monthBucket);
    const ms = startOfMonth(r.monthBucket);
    if (!monthsMap.has(mk)) monthsMap.set(mk, ms);
  }
  const sorted = [...monthsMap.entries()].sort(([a], [b]) => (a < b ? -1 : 1));

  return sorted.map(([mk, monthStart]) => {
    const rows = linkedWithDcMonth.filter(
      (r) => r.monthBucket && monthKey(r.monthBucket) === mk
    );
    const byPathway = buildSlicesForMonth(rows);
    return {
      monthKey: mk,
      monthLabel: formatMonthLabel(monthStart),
      monthStart,
      byPathway,
    };
  });
}
