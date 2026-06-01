import type { EpicConversionRecord } from '../types';
import {
  DISCHARGE_STRATEGY,
  EPISODE_CONVERSION_STRATEGY,
  ICL_REASSESSMENT_STRATEGY,
} from './recordStrategyTabs';

export const CHART_START_DATE = '2026-05-30';
export const CHART_END_DATE = '2026-06-22';

export type DailyProgressSegment =
  | 'pendingConversion'
  | 'pendingReassessment'
  | 'pendingDischarge'
  | 'completeConverted'
  | 'completeDischarged';

export interface DailyProgressSnapshot {
  date: string;
  total: number;
  pendingConversion: number;
  pendingReassessment: number;
  pendingDischarge: number;
  completeConverted: number;
  completeDischarged: number;
}

export const DAILY_PROGRESS_SEGMENT_ORDER: DailyProgressSegment[] = [
  'completeDischarged',
  'completeConverted',
  'pendingDischarge',
  'pendingReassessment',
  'pendingConversion',
];

export const DAILY_PROGRESS_SEGMENT_LABELS: Record<DailyProgressSegment, string> = {
  pendingConversion: 'Pending Conversion',
  pendingReassessment: 'Pending Reassessment',
  pendingDischarge: 'Pending Discharge',
  completeConverted: 'Converted',
  completeDischarged: 'Discharged',
};

function isoFromLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function eachDayInRange(start: string, end: string): string[] {
  const days: string[] = [];
  const cursor = new Date(`${start}T12:00:00`);
  const endDate = new Date(`${end}T12:00:00`);
  while (cursor.getTime() <= endDate.getTime()) {
    days.push(isoFromLocalDate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function dateOnOrBefore(timestamp: string | null | undefined, dayIso: string): boolean {
  if (!timestamp) return false;
  return timestamp.slice(0, 10) <= dayIso;
}

function wasImportedByDay(record: EpicConversionRecord, dayIso: string): boolean {
  return record.imported_at.slice(0, 10) <= dayIso;
}

function hadIclDecisionByDay(record: EpicConversionRecord, dayIso: string): boolean {
  if (!record.icl_decision) return false;
  if (!record.icl_decision_at) return true;
  return dateOnOrBefore(record.icl_decision_at, dayIso);
}

function belongsToEpisodeTabOnDay(record: EpicConversionRecord, dayIso: string): boolean {
  const strategy = record.episode_conversion_strategy;
  if (strategy === EPISODE_CONVERSION_STRATEGY) return true;
  return (
    strategy === ICL_REASSESSMENT_STRATEGY &&
    hadIclDecisionByDay(record, dayIso) &&
    record.icl_decision === 'convert'
  );
}

function belongsToDischargeTabOnDay(record: EpicConversionRecord, dayIso: string): boolean {
  const strategy = record.episode_conversion_strategy;
  if (strategy === DISCHARGE_STRATEGY) return true;
  return (
    strategy === ICL_REASSESSMENT_STRATEGY &&
    hadIclDecisionByDay(record, dayIso) &&
    record.icl_decision === 'discharge'
  );
}

function belongsToIclTabOnDay(record: EpicConversionRecord, dayIso: string): boolean {
  return (
    record.episode_conversion_strategy === ICL_REASSESSMENT_STRATEGY &&
    !hadIclDecisionByDay(record, dayIso)
  );
}

function wasDischargedByDay(record: EpicConversionRecord, dayIso: string): boolean {
  return dateOnOrBefore(record.discharged_at, dayIso);
}

function wasConvertedByDay(record: EpicConversionRecord, dayIso: string): boolean {
  return dateOnOrBefore(record.completed_at, dayIso);
}

function classifyRecordOnDay(
  record: EpicConversionRecord,
  dayIso: string
): DailyProgressSegment | null {
  if (!wasImportedByDay(record, dayIso)) return null;

  if (wasDischargedByDay(record, dayIso)) return 'completeDischarged';
  if (wasConvertedByDay(record, dayIso)) return 'completeConverted';
  if (belongsToIclTabOnDay(record, dayIso)) return 'pendingReassessment';
  if (belongsToDischargeTabOnDay(record, dayIso)) return 'pendingDischarge';
  if (belongsToEpisodeTabOnDay(record, dayIso)) return 'pendingConversion';

  return 'pendingConversion';
}

function emptySnapshot(date: string): DailyProgressSnapshot {
  return {
    date,
    total: 0,
    pendingConversion: 0,
    pendingReassessment: 0,
    pendingDischarge: 0,
    completeConverted: 0,
    completeDischarged: 0,
  };
}

export function computeDailyProgressSeries(
  records: EpicConversionRecord[],
  startDate: string = CHART_START_DATE,
  endDate: string = CHART_END_DATE
): DailyProgressSnapshot[] {
  const days = eachDayInRange(startDate, endDate);

  return days.map((dayIso) => {
    const snapshot = emptySnapshot(dayIso);
    for (const record of records) {
      const segment = classifyRecordOnDay(record, dayIso);
      if (!segment) continue;
      snapshot[segment] += 1;
      snapshot.total += 1;
    }
    return snapshot;
  });
}

export function maxDailyTotal(series: DailyProgressSnapshot[]): number {
  let max = 0;
  for (const day of series) {
    if (day.total > max) max = day.total;
  }
  return max;
}

export function formatChartDayLabel(dayIso: string): string {
  const d = new Date(`${dayIso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return dayIso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function formatChartDayLabelParts(dayIso: string): { month: string; day: string } {
  const d = new Date(`${dayIso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return { month: dayIso, day: '' };
  return {
    month: d.toLocaleDateString('en-US', { month: 'short' }),
    day: d.toLocaleDateString('en-US', { day: 'numeric' }),
  };
}

export function formatChartAxisDay(dayIso: string): string {
  const d = new Date(`${dayIso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return dayIso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function yAxisTicks(maxTotal: number): number[] {
  if (maxTotal <= 0) return [0];
  const step = maxTotal <= 10 ? 1 : maxTotal <= 50 ? 5 : maxTotal <= 200 ? 25 : 100;
  const top = Math.ceil(maxTotal / step) * step;
  const ticks: number[] = [];
  for (let value = 0; value <= top; value += step) {
    ticks.push(value);
  }
  return ticks.reverse();
}
