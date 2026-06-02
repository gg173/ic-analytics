import { DISCHARGE_STRATEGY } from '../progress/recordStrategyTabs';
import type { DischargeDateSource, DischargeReason, EpicConversionRecord } from '../types';

/** Discharge reason when a patient no longer appears on the VHA SSDB export. */
export const SSDB_ABSENCE_DISCHARGE_REASON: DischargeReason = 'Other';

function addDaysToIsoDate(isoDate: string, days: number): string | null {
  const d = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function programEndDaysForPathway(pathway: string | null | undefined): number {
  return pathway === 'UHN-TRANSITION' ? 120 : 90;
}

/** Expected program end from Hosp DC Date (+90 days, or +120 for UHN-TRANSITION). */
export function computeExpectedProgramEndDate(
  hospDcDate: string | null | undefined,
  pathway: string | null | undefined
): string | null {
  if (!hospDcDate?.trim()) return null;
  return addDaysToIsoDate(hospDcDate.trim(), programEndDaysForPathway(pathway));
}

function computePddDate(
  record: Pick<EpicConversionRecord, 'hosp_dc_date' | 'registration_date' | 'pathway'>
): string | null {
  const base = record.hosp_dc_date ?? record.registration_date;
  if (!base) return null;
  return addDaysToIsoDate(base, programEndDaysForPathway(record.pathway));
}

export function resolveSsdbAbsenceDischargeDate(
  record: Pick<EpicConversionRecord, 'lvd' | 'hosp_dc_date' | 'registration_date' | 'pathway'>
): { discharge_date_source: DischargeDateSource; discharge_date: string } {
  if (record.lvd) {
    return { discharge_date_source: 'lvd', discharge_date: record.lvd };
  }
  const pdd = computePddDate(record);
  if (pdd) {
    return { discharge_date_source: 'pdd', discharge_date: pdd };
  }
  const fallback =
    record.hosp_dc_date ?? record.registration_date ?? new Date().toISOString().slice(0, 10);
  return { discharge_date_source: 'other', discharge_date: fallback };
}

export function buildSsdbAbsenceDischargeUpdate(
  record: Pick<
    EpicConversionRecord,
    'lvd' | 'hosp_dc_date' | 'registration_date' | 'pathway'
  >,
  dischargedBy: string,
  dischargedAt: string
) {
  const dischargeFields = resolveSsdbAbsenceDischargeDate(record);
  return {
    episode_conversion_strategy: DISCHARGE_STRATEGY,
    icl_decision: null,
    icl_decision_by: null,
    icl_decision_at: null,
    completed_by: null,
    completed_at: null,
    ...dischargeFields,
    discharge_reason: SSDB_ABSENCE_DISCHARGE_REASON,
    status: 'discharged' as const,
    discharged_by: dischargedBy,
    discharged_at: dischargedAt,
  };
}

export function enrollIdsAbsentFromSsdbUpload(
  activeRecords: Pick<EpicConversionRecord, 'enroll_id'>[],
  uploadEnrollIds: ReadonlySet<string>
): string[] {
  const absent: string[] = [];
  for (const record of activeRecords) {
    const enrollId = record.enroll_id;
    if (!enrollId || uploadEnrollIds.has(enrollId)) continue;
    absent.push(enrollId);
  }
  return absent;
}
