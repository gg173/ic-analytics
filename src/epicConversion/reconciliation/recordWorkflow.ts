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

/** Why an Epic report row matched a VHA patient who is not marked Converted. */
export function describeStatusDiscrepancy(workflowStatusLabel: string | null): string {
  if (!workflowStatusLabel) {
    return 'In Epic report but patient is not marked Converted in VHA';
  }

  const explanations: Record<string, string> = {
    Discharged:
      'In Epic report but patient is Discharged in VHA — discharged patients should not appear in the Epic conversion report',
    'Episode Conversion Pending':
      'In Epic report but conversion is not marked complete in VHA — mark as Converted to match this Epic episode',
    'ICL Reassessment Pending':
      'In Epic report but ICL reassessment is still pending in VHA — patient must be marked Converted to validate',
    'ICL Discharge Pending':
      'In Epic report but ICL selected discharge in VHA — patient should not appear in the Epic conversion report',
    'Discharge Pending':
      'In Epic report but patient is pending discharge in VHA — only Converted patients should match an Epic episode',
    Other:
      'In Epic report but VHA workflow status is not Converted',
  };

  return (
    explanations[workflowStatusLabel] ??
    `In Epic report but VHA status is ${workflowStatusLabel} (expected Converted)`
  );
}
