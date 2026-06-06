import type { EpicConversionRecord } from '../types';
import {
  DISCHARGE_STRATEGY,
  EPISODE_CONVERSION_STRATEGY,
  ICL_REASSESSMENT_STRATEGY,
  isRecordPending,
  recordBelongsToStrategyTab,
} from './recordStrategyTabs';

export interface BucketMetrics {
  total: number;
  pending: number;
  complete: number;
  percentComplete: number;
  validatedComplete?: number;
}

export interface IclBucketMetrics {
  decisionRequired: number;
  decidedConvert: number;
  decidedDischarge: number;
  total: number;
  pending: number;
  complete: number;
  percentComplete: number;
}

export interface ProgressMetrics {
  totalRecords: number;
  accounted: number;
  pending: number;
  percentAccounted: number;
  episodeConversion: BucketMetrics;
  iclReassessment: IclBucketMetrics;
  programDischarge: BucketMetrics;
  daysUntilGoLive: number | null;
}

const GO_LIVE_DATE = '2026-06-22';

function bucketMetrics(total: number, pending: number): BucketMetrics {
  const complete = total - pending;
  return {
    total,
    pending,
    complete,
    percentComplete: total > 0 ? Math.round((complete / total) * 100) : 0,
  };
}

function daysUntilGoLive(referenceDate: Date = new Date()): number | null {
  const goLive = new Date(`${GO_LIVE_DATE}T12:00:00`);
  if (Number.isNaN(goLive.getTime())) return null;
  const today = new Date(referenceDate);
  today.setHours(12, 0, 0, 0);
  return Math.ceil((goLive.getTime() - today.getTime()) / 86400000);
}

export function computeProgressMetrics(
  records: EpicConversionRecord[],
  referenceDate: Date = new Date(),
  validatedRecordIds?: ReadonlySet<string>
): ProgressMetrics {
  let episodeTotal = 0;
  let episodePending = 0;
  let episodeValidatedComplete = 0;
  let dischargeTotal = 0;
  let dischargePending = 0;
  let iclDecisionRequired = 0;
  let iclDecidedConvert = 0;
  let iclDecidedDischarge = 0;

  for (const r of records) {
    if (recordBelongsToStrategyTab(r, EPISODE_CONVERSION_STRATEGY)) {
      episodeTotal += 1;
      if (!r.completed_at) episodePending += 1;
      else if (validatedRecordIds?.has(r.id)) episodeValidatedComplete += 1;
    }
    if (recordBelongsToStrategyTab(r, DISCHARGE_STRATEGY)) {
      dischargeTotal += 1;
      if (r.status !== 'discharged') dischargePending += 1;
    }
    if (r.episode_conversion_strategy === ICL_REASSESSMENT_STRATEGY) {
      if (!r.icl_decision) iclDecisionRequired += 1;
      else if (r.icl_decision === 'convert') iclDecidedConvert += 1;
      else if (r.icl_decision === 'discharge') iclDecidedDischarge += 1;
    }
  }

  const iclTotal = iclDecisionRequired + iclDecidedConvert + iclDecidedDischarge;
  const iclPending = iclDecisionRequired;
  const iclComplete = iclDecidedConvert + iclDecidedDischarge;

  const pending = records.filter(isRecordPending).length;
  const totalRecords = records.length;
  const accounted = totalRecords - pending;

  return {
    totalRecords,
    accounted,
    pending,
    percentAccounted: totalRecords > 0 ? Math.round((accounted / totalRecords) * 100) : 0,
    episodeConversion: {
      ...bucketMetrics(episodeTotal, episodePending),
      validatedComplete: validatedRecordIds ? episodeValidatedComplete : undefined,
    },
    iclReassessment: {
      decisionRequired: iclDecisionRequired,
      decidedConvert: iclDecidedConvert,
      decidedDischarge: iclDecidedDischarge,
      total: iclTotal,
      pending: iclPending,
      complete: iclComplete,
      percentComplete: iclTotal > 0 ? Math.round((iclComplete / iclTotal) * 100) : 0,
    },
    programDischarge: bucketMetrics(dischargeTotal, dischargePending),
    daysUntilGoLive: daysUntilGoLive(referenceDate),
  };
}
