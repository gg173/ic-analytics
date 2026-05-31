/** Program LOS buckets (days since HOSP DC DATE through today). Stored without a "days" suffix — UI appends " days". */
export type LosCategory = '<30' | '30-45' | '45-60' | '60-90' | '> 90';

export type LatestSrvCategory =
  | 'No visit recorded'
  | 'Future service scheduled'
  | '0-7 days ago'
  | '7-14 days ago'
  | '14-30 days ago'
  | '> 30 days ago';

export type StrategyColor = 'Green' | 'Yellow' | 'Red';

export const EPISODE_CONVERSION_STRATEGY_BY_COLOR = {
  Green: 'Manually Convert Episode',
  Yellow: 'TBD: Conversion at the Discretion of ICL',
  Red: 'Do Not Convert: Overdue Discharge',
} as const;

const STRATEGY_MATRIX: Partial<
  Record<LosCategory, Partial<Record<LatestSrvCategory, StrategyColor>>>
> = {
  '<30': {
    'No visit recorded': 'Green',
    'Future service scheduled': 'Green',
    '0-7 days ago': 'Green',
    '7-14 days ago': 'Green',
    '14-30 days ago': 'Green',
  },
  '30-45': {
    'Future service scheduled': 'Green',
    '0-7 days ago': 'Yellow',
    '7-14 days ago': 'Yellow',
    '14-30 days ago': 'Yellow',
    '> 30 days ago': 'Yellow',
  },
  '45-60': {
    'Future service scheduled': 'Green',
    '0-7 days ago': 'Yellow',
    '7-14 days ago': 'Yellow',
    '14-30 days ago': 'Yellow',
    '> 30 days ago': 'Red',
  },
  '60-90': {
    'No visit recorded': 'Red',
    'Future service scheduled': 'Green',
    '0-7 days ago': 'Yellow',
    '7-14 days ago': 'Yellow',
    '14-30 days ago': 'Yellow',
    '> 30 days ago': 'Red',
  },
  '> 90': {
    'Future service scheduled': 'Yellow',
    '0-7 days ago': 'Yellow',
    '7-14 days ago': 'Red',
    '14-30 days ago': 'Red',
    '> 30 days ago': 'Red',
  },
};

export function programLosDays(hospDcIso: string | null, referenceDate: Date): number | null {
  if (!hospDcIso) return null;
  const from = new Date(`${hospDcIso}T12:00:00`);
  const to = new Date(referenceDate);
  to.setHours(12, 0, 0, 0);
  if (Number.isNaN(from.getTime())) return null;
  return Math.floor((to.getTime() - from.getTime()) / 86400000);
}

export function losCategoryFromDays(days: number | null): LosCategory | null {
  if (days == null || !Number.isFinite(days)) return null;
  if (days < 30) return '<30';
  if (days <= 45) return '30-45';
  if (days <= 60) return '45-60';
  if (days <= 90) return '60-90';
  return '> 90';
}

export function daysSinceDate(isoDate: string | null, referenceDate: Date): number | null {
  if (!isoDate) return null;
  const from = new Date(`${isoDate}T12:00:00`);
  const to = new Date(referenceDate);
  to.setHours(12, 0, 0, 0);
  if (Number.isNaN(from.getTime())) return null;
  return Math.floor((to.getTime() - from.getTime()) / 86400000);
}

export function latestSrvCategory(
  lvdIso: string | null,
  referenceDate: Date
): LatestSrvCategory {
  if (!lvdIso) return 'No visit recorded';
  const days = daysSinceDate(lvdIso, referenceDate);
  if (days == null) return 'No visit recorded';
  if (days < 0) return 'Future service scheduled';
  if (days <= 7) return '0-7 days ago';
  if (days <= 14) return '7-14 days ago';
  if (days <= 30) return '14-30 days ago';
  return '> 30 days ago';
}

export function daysSinceLvdForImport(
  lvdIso: string | null,
  referenceDate: Date
): number | null {
  const days = daysSinceDate(lvdIso, referenceDate);
  if (days == null || days < 0) return null;
  return days;
}

export function episodeConversionStrategy(
  losCategory: LosCategory | null,
  latestSrv: LatestSrvCategory
): string | null {
  if (!losCategory) return null;
  const color = STRATEGY_MATRIX[losCategory]?.[latestSrv];
  if (!color) return null;
  return EPISODE_CONVERSION_STRATEGY_BY_COLOR[color];
}
