import { normalizeMrnForMatch } from '../reconciliation/reconcileReportRows';
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

/** MRNs already converted or discharged on any enrolment record. */
export function buildHandledMrnSet(
  records: readonly EpicConversionRecord[]
): ReadonlySet<string> {
  const handled = new Set<string>();
  for (const r of records) {
    if (r.completed_at != null || r.status === 'discharged') {
      const key = normalizeMrnForMatch(r.mrn);
      if (key) handled.add(key);
    }
  }
  return handled;
}

export function isIclDecisionRequiredRecord(
  r: EpicConversionRecord,
  handledMrns?: ReadonlySet<string>
): boolean {
  if (r.episode_conversion_strategy !== ICL_REASSESSMENT_STRATEGY) return false;
  if (r.icl_decision) return false;
  if (handledMrns) {
    const key = normalizeMrnForMatch(r.mrn);
    if (key && handledMrns.has(key)) return false;
  }
  return true;
}

export function recordBelongsToStrategyTab(
  r: EpicConversionRecord,
  tab: string,
  handledMrns?: ReadonlySet<string>
): boolean {
  const strategy = r.episode_conversion_strategy ?? NO_STRATEGY_LABEL;
  if (tab === NO_STRATEGY_LABEL) {
    return strategy === NO_STRATEGY_LABEL && r.completed_at == null;
  }
  if (tab === ICL_REASSESSMENT_STRATEGY) {
    return isIclDecisionRequiredRecord(r, handledMrns);
  }
  if (tab === EPISODE_CONVERSION_STRATEGY) {
    if (r.completed_at != null) return true;
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
export function recordBelongsToStrategyTabBadge(
  r: EpicConversionRecord,
  tab: string,
  handledMrns?: ReadonlySet<string>
): boolean {
  if (!recordBelongsToStrategyTab(r, tab, handledMrns)) return false;
  if (tab === EPISODE_CONVERSION_STRATEGY) return !r.completed_at;
  if (tab === DISCHARGE_STRATEGY) return r.status !== 'discharged';
  return true;
}

export function isRecordPending(
  r: EpicConversionRecord,
  handledMrns?: ReadonlySet<string>
): boolean {
  return (
    recordBelongsToStrategyTabBadge(r, EPISODE_CONVERSION_STRATEGY, handledMrns) ||
    recordBelongsToStrategyTabBadge(r, ICL_REASSESSMENT_STRATEGY, handledMrns) ||
    recordBelongsToStrategyTabBadge(r, DISCHARGE_STRATEGY, handledMrns)
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
  rows: { episode_conversion_strategy?: string | null }[]
): StrategyBreakdown {
  const counts: StrategyBreakdown = {
    episodeConversion: 0,
    iclReassessment: 0,
    programDischarge: 0,
    other: 0,
  };
  for (const row of rows) {
    const strategy = row.episode_conversion_strategy;
    if (strategy === EPISODE_CONVERSION_STRATEGY) counts.episodeConversion += 1;
    else if (strategy === ICL_REASSESSMENT_STRATEGY) counts.iclReassessment += 1;
    else if (strategy === DISCHARGE_STRATEGY) counts.programDischarge += 1;
    else counts.other += 1;
  }
  return counts;
}
