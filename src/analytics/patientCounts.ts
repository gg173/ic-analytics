import type { MergedClinicalRow } from '../data/types';

/** Calendar day at local midnight (strips time-of-day). */
export function startOfCalendarDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * Active on `day` when index date is on or before that day and program discharge
 * is missing or strictly after that day (not active on the discharge day).
 */
export function isPatientActiveOnDay(
  row: Pick<MergedClinicalRow, 'indexDate' | 'progDcDate'>,
  day: Date
): boolean {
  if (!row.indexDate) return false;
  const d = startOfCalendarDay(day);
  const idx = startOfCalendarDay(row.indexDate);
  if (idx.getTime() > d.getTime()) return false;
  if (!row.progDcDate) return true;
  return startOfCalendarDay(row.progDcDate).getTime() > d.getTime();
}

export function lastDayOfMonth(monthStart: Date): Date {
  return new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
}

/** Inclusive range of calendar days from `start` through `end`. */
export function enumerateCalendarDaysInclusive(start: Date, end: Date): Date[] {
  const out: Date[] = [];
  let cur = startOfCalendarDay(start);
  const endMs = startOfCalendarDay(end).getTime();
  while (cur.getTime() <= endMs) {
    out.push(new Date(cur));
    cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1);
  }
  return out;
}

export interface DailyActivePatientPoint {
  dayKey: string;
  dayLabel: string;
  activeCount: number;
}

export function buildDailyActivePatientSeries(
  rows: readonly Pick<MergedClinicalRow, 'indexDate' | 'progDcDate'>[],
  days: readonly Date[]
): DailyActivePatientPoint[] {
  return days.map((day) => {
    let activeCount = 0;
    for (const row of rows) {
      if (isPatientActiveOnDay(row, day)) activeCount += 1;
    }
    return {
      dayKey: day.toISOString().slice(0, 10),
      dayLabel: day.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
      }),
      activeCount,
    };
  });
}

/** Calendar days from index date through `asOfDay` (inclusive). */
export function lengthOfStayDaysOnDay(indexDate: Date, asOfDay: Date): number {
  const d = startOfCalendarDay(asOfDay);
  const idx = startOfCalendarDay(indexDate);
  return Math.round((d.getTime() - idx.getTime()) / (24 * 3600 * 1000));
}

/** Bin index 0–4 for active-patient LOS on a given day. */
export function losBinIndex(losDays: number): number {
  if (losDays <= 30) return 0;
  if (losDays <= 45) return 1;
  if (losDays <= 60) return 2;
  if (losDays <= 90) return 3;
  return 4;
}

export const PATIENT_COUNT_LOS_STRAT_LABELS = [
  'LOS ≤30 days',
  '30 < LOS ≤45',
  '45 < LOS ≤60',
  '60 < LOS ≤90',
  'LOS >90',
] as const;

/** Blue shades for shorter LOS; red for >90 days. */
export const PATIENT_COUNT_LOS_COLORS = [
  '#dbeafe',
  '#93c5fd',
  '#3b82f6',
  '#1d4ed8',
  '#dc2626',
] as const;

export const PATIENT_COUNT_LOS_BIN_COUNT = PATIENT_COUNT_LOS_STRAT_LABELS.length;

export type DailyActivePatientLosStackRow = {
  dayKey: string;
  dayLabel: string;
  volume: number;
} & Record<`_e${number}`, number>;

/**
 * Per day, count active patients in each LOS bin (LOS = as-of day − index date).
 */
export function buildDailyActivePatientLosStackSeries(
  rows: readonly Pick<MergedClinicalRow, 'indexDate' | 'progDcDate'>[],
  days: readonly Date[]
): DailyActivePatientLosStackRow[] {
  return days.map((day) => {
    const row: DailyActivePatientLosStackRow = {
      dayKey: day.toISOString().slice(0, 10),
      dayLabel: day.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
      }),
      volume: 0,
    };
    for (let i = 0; i < PATIENT_COUNT_LOS_BIN_COUNT; i += 1) {
      row[`_e${i}`] = 0;
    }
    for (const patient of rows) {
      if (!isPatientActiveOnDay(patient, day) || !patient.indexDate) continue;
      const los = lengthOfStayDaysOnDay(patient.indexDate, day);
      const bin = losBinIndex(los);
      row[`_e${bin}`] = Number(row[`_e${bin}`]) + 1;
      row.volume += 1;
    }
    return row;
  });
}
