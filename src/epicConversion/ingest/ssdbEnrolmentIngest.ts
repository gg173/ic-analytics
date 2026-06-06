import {
  DISCHARGE_STRATEGY,
  EPISODE_CONVERSION_STRATEGY,
} from '../progress/recordStrategyTabs';
import type { EpicConversionInsertRow, EpicConversionRecord } from '../types';

/** SSDB-sourced enrolment fields refreshed on each SSDB upload (workflow fields preserved). */
export const SSDB_ENROLMENT_SYNC_FIELD_NAMES = [
  'gcn',
  'mrn',
  'pathway',
  'care_path',
  'support_tier',
  'ic_lead',
  'registration_date',
  'hosp_dc_date',
  'episode_conversion_strategy',
  'los',
  'los_category',
  'latest_srv',
  'days_since_lvd',
  'lvd',
  'lvt',
  'source_filename',
] as const;

export type SsdbEnrolmentSyncField = (typeof SSDB_ENROLMENT_SYNC_FIELD_NAMES)[number];

export type SsdbEnrolmentSyncSnapshot = Pick<
  EpicConversionRecord,
  SsdbEnrolmentSyncField
>;

function normStr(value: string | null | undefined): string {
  return (value ?? '').trim();
}

function normOptionalStr(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed || null;
}

function normNumber(value: number | null | undefined): number | null {
  return value ?? null;
}

/** Stable fingerprint for SSDB enrolment rows (detect file-driven changes). */
export function ssdbEnrolmentChangeFingerprint(
  row: Pick<EpicConversionInsertRow, SsdbEnrolmentSyncField>
): string {
  return SSDB_ENROLMENT_SYNC_FIELD_NAMES.map((field) => {
    const value = row[field];
    if (typeof value === 'number') return String(value);
    return normStr(value as string | null | undefined);
  }).join('\0');
}

export function enrolmentRowsMatchForIngest(
  existing: SsdbEnrolmentSyncSnapshot,
  incoming: EpicConversionInsertRow,
  incomingFingerprint?: string
): boolean {
  return (
    ssdbEnrolmentChangeFingerprint(existing) ===
    (incomingFingerprint ?? ssdbEnrolmentChangeFingerprint(incoming))
  );
}

export function buildSsdbEnrolmentUpsertPayload(
  existingId: string,
  existing: Parameters<typeof buildSsdbEnrolmentSyncUpdate>[0],
  incoming: EpicConversionInsertRow
): Record<string, unknown> {
  return {
    id: existingId,
    ...buildSsdbEnrolmentSyncUpdate(existing, incoming),
  };
}

/** DB patch: latest SSDB columns + metrics; clears workflow state incompatible with new strategy. */
export function buildSsdbEnrolmentSyncUpdate(
  existing: Pick<
    EpicConversionRecord,
    | SsdbEnrolmentSyncField
    | 'episode_conversion_strategy'
    | 'icl_decision'
    | 'status'
    | 'discharge_date'
    | 'discharge_date_source'
    | 'discharge_reason'
  >,
  incoming: EpicConversionInsertRow
): Record<string, unknown> {
  const sync: Record<string, unknown> = {
    gcn: normOptionalStr(incoming.gcn),
    mrn: incoming.mrn.trim(),
    pathway: normOptionalStr(incoming.pathway),
    care_path: normOptionalStr(incoming.care_path),
    support_tier: normOptionalStr(incoming.support_tier),
    ic_lead: normOptionalStr(incoming.ic_lead),
    registration_date: incoming.registration_date,
    hosp_dc_date: incoming.hosp_dc_date,
    episode_conversion_strategy: incoming.episode_conversion_strategy,
    los: normOptionalStr(incoming.los),
    los_category: incoming.los_category,
    latest_srv: incoming.latest_srv,
    days_since_lvd: normNumber(incoming.days_since_lvd),
    lvd: incoming.lvd,
    lvt: normOptionalStr(incoming.lvt),
    source_filename: incoming.source_filename,
  };

  const nextStrategy = incoming.episode_conversion_strategy;
  const prevStrategy = existing.episode_conversion_strategy;

  if (nextStrategy !== prevStrategy) {
    // Preserve submitted ICL decisions across metric-driven strategy changes (e.g. ICL →
    // Episode Conversion → ICL as LOS/LVD updates). Only clear when the new SSDB strategy
    // directly contradicts the prior decision.
    if (existing.icl_decision === 'discharge' && nextStrategy === EPISODE_CONVERSION_STRATEGY) {
      sync.icl_decision = null;
      sync.icl_decision_by = null;
      sync.icl_decision_at = null;
    } else if (
      existing.icl_decision === 'convert' &&
      nextStrategy === DISCHARGE_STRATEGY
    ) {
      sync.icl_decision = null;
      sync.icl_decision_by = null;
      sync.icl_decision_at = null;
    }

    const wasDischargePending =
      prevStrategy === DISCHARGE_STRATEGY && existing.status !== 'discharged';
    const isDischargePending =
      nextStrategy === DISCHARGE_STRATEGY && existing.status !== 'discharged';

    if (wasDischargePending && !isDischargePending) {
      sync.discharge_date_source = null;
      sync.discharge_date = null;
      sync.discharge_reason = null;
    }

  }


  return sync;
}


/** Merge SSDB row onto an Epic-provisioned enrolment; preserve convert validation. */
export function buildSsdbEnrolmentMergeOntoEpicProvisioned(
  existing: Pick<
    EpicConversionRecord,
    | (typeof SSDB_ENROLMENT_SYNC_FIELD_NAMES)[number]
    | 'episode_conversion_strategy'
    | 'icl_decision'
    | 'icl_decision_by'
    | 'icl_decision_at'
    | 'status'
    | 'discharge_date'
    | 'discharge_date_source'
    | 'discharge_reason'
    | 'completed_at'
    | 'completed_by'
  >,
  incoming: EpicConversionInsertRow
): Record<string, unknown> {
  const sync = buildSsdbEnrolmentSyncUpdate(existing, incoming);
  sync.enroll_id = incoming.enroll_id?.trim() ?? null;
  sync.completed_at = existing.completed_at;
  sync.completed_by = existing.completed_by;
  if (existing.completed_at) {
    sync.episode_conversion_strategy =
      existing.episode_conversion_strategy ?? EPISODE_CONVERSION_STRATEGY;
    if (existing.icl_decision) {
      sync.icl_decision = existing.icl_decision;
      sync.icl_decision_by = existing.icl_decision_by;
      sync.icl_decision_at = existing.icl_decision_at;
    }
  }
  return sync;
}
