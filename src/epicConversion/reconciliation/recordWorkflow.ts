import type { EpicConversionRecord } from '../types';
import {
  DISCHARGE_STRATEGY,
  EPISODE_CONVERSION_STRATEGY,
  ICL_REASSESSMENT_STRATEGY,
} from '../progress/recordStrategyTabs';

export type VhaWorkflowStatus =
  | 'converted'
  | 'discharged'
  | 'icl_reassessment_pending'
  | 'icl_discharge_pending'
  | 'episode_conversion_pending'
  | 'discharge_pending'
  | 'other';

export function getVhaWorkflowStatus(record: EpicConversionRecord): VhaWorkflowStatus {
  if (record.completed_at) return 'converted';
  if (record.status === 'discharged') return 'discharged';

  const strategy = record.episode_conversion_strategy;
  if (strategy === ICL_REASSESSMENT_STRATEGY) {
    if (!record.icl_decision) return 'icl_reassessment_pending';
    if (record.icl_decision === 'discharge') return 'icl_discharge_pending';
    return 'episode_conversion_pending';
  }
  if (strategy === DISCHARGE_STRATEGY) return 'discharge_pending';
  if (strategy === EPISODE_CONVERSION_STRATEGY) return 'episode_conversion_pending';
  return 'other';
}

export const VHA_WORKFLOW_STATUS_LABELS: Record<VhaWorkflowStatus, string> = {
  converted: 'Converted',
  discharged: 'Discharged',
  icl_reassessment_pending: 'ICL Reassessment Pending',
  icl_discharge_pending: 'ICL Discharge Pending',
  episode_conversion_pending: 'Episode Conversion Pending',
  discharge_pending: 'Discharge Pending',
  other: 'Other',
};

/** Epic rows should only align with converted patients; any other matched state is a discrepancy. */
export function isMatchedStatusDiscrepancy(record: EpicConversionRecord): boolean {
  return getVhaWorkflowStatus(record) !== 'converted';
}
