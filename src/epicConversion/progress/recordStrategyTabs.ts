import type { EpicConversionRecord } from '../types';

export const NO_STRATEGY_LABEL = 'No conversion strategy';

export const STRATEGY_TAB_LABELS: Record<string, string> = {
  'Manually Convert Episode': 'Episode Conversion',
  'TBD: Conversion at the Discretion of ICL': 'ICL Reassessment Required',
  'Do Not Convert: Overdue Discharge': 'Discharge from Program',
};

export const STRATEGY_TAB_ORDER = [
  'Manually Convert Episode',
  'TBD: Conversion at the Discretion of ICL',
  'Do Not Convert: Overdue Discharge',
] as const;

export const EPISODE_CONVERSION_STRATEGY = 'Manually Convert Episode';
export const ICL_REASSESSMENT_STRATEGY = 'TBD: Conversion at the Discretion of ICL';
export const DISCHARGE_STRATEGY = 'Do Not Convert: Overdue Discharge';

/** True when a record still needs an ICL convert/discharge decision. */
export function recordNeedsIclReassessment(
  r: Pick<
    EpicConversionRecord,
    'episode_conversion_strategy' | 'icl_decision' | 'completed_at' | 'status'
  >
): boolean {
  if (r.completed_at) return false;
  if (r.status === 'discharged') return false;
  return r.episode_conversion_strategy === ICL_REASSESSMENT_STRATEGY && !r.icl_decision;
}

export function recordBelongsToStrategyTab(r: EpicConversionRecord, tab: string): boolean {
  if (r.completed_at) {
    return tab === EPISODE_CONVERSION_STRATEGY;
  }
  if (r.status === 'discharged') {
    return tab === DISCHARGE_STRATEGY;
  }

  const strategy = r.episode_conversion_strategy ?? NO_STRATEGY_LABEL;
  if (tab === NO_STRATEGY_LABEL) return strategy === NO_STRATEGY_LABEL;
  if (tab === ICL_REASSESSMENT_STRATEGY) {
    return recordNeedsIclReassessment(r);
  }
  if (tab === EPISODE_CONVERSION_STRATEGY) {
    return (
      strategy === EPISODE_CONVERSION_STRATEGY ||
      (strategy === ICL_REASSESSMENT_STRATEGY && r.icl_decision === 'convert')
    );
  }
  if (tab === DISCHARGE_STRATEGY) {
    return (
      strategy === DISCHARGE_STRATEGY ||
      (strategy === ICL_REASSESSMENT_STRATEGY && r.icl_decision === 'discharge')
    );
  }
  return strategy === tab;
}

/** Tab badge counts match each strategy tab's primary (main) split panel. */
export function recordBelongsToStrategyTabBadge(r: EpicConversionRecord, tab: string): boolean {
  if (!recordBelongsToStrategyTab(r, tab)) return false;
  if (tab === EPISODE_CONVERSION_STRATEGY) return !r.completed_at;
  if (tab === DISCHARGE_STRATEGY) return r.status !== 'discharged';
  return true;
}

export function isRecordPending(r: EpicConversionRecord): boolean {
  return (
    recordBelongsToStrategyTabBadge(r, EPISODE_CONVERSION_STRATEGY) ||
    recordBelongsToStrategyTabBadge(r, ICL_REASSESSMENT_STRATEGY) ||
    recordBelongsToStrategyTabBadge(r, DISCHARGE_STRATEGY)
  );
}

export function strategyTabLabel(raw: string): string {
  return STRATEGY_TAB_LABELS[raw] ?? raw;
}

export function sortStrategyTabs(tabs: string[]): string[] {
  const orderIndex = new Map(STRATEGY_TAB_ORDER.map((key, i) => [key, i]));
  return [...tabs].sort((a, b) => {
    const ai = orderIndex.get(a as (typeof STRATEGY_TAB_ORDER)[number]);
    const bi = orderIndex.get(b as (typeof STRATEGY_TAB_ORDER)[number]);
    if (ai != null && bi != null) return ai - bi;
    if (ai != null) return -1;
    if (bi != null) return 1;
    return a.localeCompare(b);
  });
}

export interface StrategyBreakdown {
  episodeConversion: number;
  iclReassessment: number;
  programDischarge: number;
  other: number;
}

export function countStrategyBreakdown(
  rows: {
    episode_conversion_strategy?: string | null;
    icl_decision?: EpicConversionRecord['icl_decision'];
    completed_at?: string | null;
    status?: EpicConversionRecord['status'];
  }[]
): StrategyBreakdown {
  const counts: StrategyBreakdown = {
    episodeConversion: 0,
    iclReassessment: 0,
    programDischarge: 0,
    other: 0,
  };
  for (const row of rows) {
    if (row.completed_at) {
      counts.episodeConversion += 1;
      continue;
    }
    if (row.status === 'discharged') {
      counts.programDischarge += 1;
      continue;
    }

    const strategy = row.episode_conversion_strategy;
    if (strategy === ICL_REASSESSMENT_STRATEGY) {
      if (row.icl_decision === 'convert') counts.episodeConversion += 1;
      else if (row.icl_decision === 'discharge') counts.programDischarge += 1;
      else counts.iclReassessment += 1;
      continue;
    }
    if (strategy === EPISODE_CONVERSION_STRATEGY) counts.episodeConversion += 1;
    else if (strategy === DISCHARGE_STRATEGY) counts.programDischarge += 1;
    else counts.other += 1;
  }
  return counts;
}
