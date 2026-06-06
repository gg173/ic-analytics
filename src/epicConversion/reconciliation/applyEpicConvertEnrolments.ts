import {
  EPISODE_CONVERSION_STRATEGY,
  ICL_REASSESSMENT_STRATEGY,
} from '../progress/recordStrategyTabs';
import type { EpicConversionRecord } from '../types';
import {
  isPerfectFieldMatch,
  normalizeMrnForMatch,
} from './reconcileReportRows';
import type { EpicConversionReportRow } from './types';

export function hasEnrolmentDecision(
  record: Pick<EpicConversionRecord, 'completed_at' | 'status'>
): boolean {
  return record.completed_at != null || record.status === 'discharged';
}

function pickBestVhaCandidate(
  reportRow: EpicConversionReportRow,
  candidates: EpicConversionRecord[]
): EpicConversionRecord {
  const perfectMatches = candidates.filter((record) => isPerfectFieldMatch(reportRow, record));
  if (perfectMatches.length) {
    const converted = perfectMatches.find((record) => record.completed_at);
    return converted ?? perfectMatches[0];
  }
  return candidates[0];
}

export function buildRecordsByMrn(
  records: readonly EpicConversionRecord[]
): Map<string, EpicConversionRecord[]> {
  const map = new Map<string, EpicConversionRecord[]>();
  for (const record of records) {
    const key = normalizeMrnForMatch(record.mrn);
    if (!key) continue;
    const list = map.get(key) ?? [];
    list.push(record);
    map.set(key, list);
  }
  return map;
}

/** Insert payload for an Epic-report-only patient (no VHA enrolment yet). */
export function buildEpicProvisionedEnrolmentInsert(
  reportRow: EpicConversionReportRow,
  sourceFilename: string,
  importedAt: string,
  importedBy: string | null
): Record<string, unknown> {
  return {
    enroll_id: null,
    gcn: null,
    mrn: reportRow.mrn.trim(),
    pathway: reportRow.pathway,
    care_path: null,
    support_tier: null,
    ic_lead: reportRow.ic_lead,
    registration_date: null,
    hosp_dc_date: reportRow.hosp_dc_date,
    episode_conversion_strategy: EPISODE_CONVERSION_STRATEGY,
    los: null,
    los_category: null,
    latest_srv: null,
    days_since_lvd: null,
    lvd: null,
    lvt: null,
    source_filename: `Epic: ${sourceFilename}`,
    imported_at: importedAt,
    imported_by: importedBy,
    completed_at: importedAt,
    completed_by: importedBy,
  };
}

/** Patch an existing VHA row when Epic report proves conversion. */
export function buildEpicConvertValidationPatch(
  record: EpicConversionRecord,
  importedAt: string,
  importedBy: string | null
): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    episode_conversion_strategy: EPISODE_CONVERSION_STRATEGY,
    completed_at: importedAt,
    completed_by: importedBy,
  };

  if (
    record.episode_conversion_strategy === ICL_REASSESSMENT_STRATEGY &&
    record.icl_decision !== 'discharge'
  ) {
    patch.icl_decision = 'convert';
    patch.icl_decision_by = importedBy;
    patch.icl_decision_at = importedAt;
  }

  return patch;
}

export interface EpicConvertEnrolmentPlan {
  inserts: Record<string, unknown>[];
  updates: Record<string, unknown>[];
}

/** Plan DB writes: provision Epic-only MRNs and mark matched VHA rows converted. */
export function planEpicConvertEnrolments(
  reportRows: EpicConversionReportRow[],
  vhaRecords: readonly EpicConversionRecord[],
  options: {
    sourceFilename: string;
    importedAt: string;
    importedBy: string | null;
  }
): EpicConvertEnrolmentPlan {
  const byMrn = buildRecordsByMrn(vhaRecords);
  const inserts: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];

  for (const reportRow of reportRows) {
    const key = normalizeMrnForMatch(reportRow.mrn);
    const candidates = key ? (byMrn.get(key) ?? []) : [];

    if (!candidates.length) {
      inserts.push(
        buildEpicProvisionedEnrolmentInsert(
          reportRow,
          options.sourceFilename,
          options.importedAt,
          options.importedBy
        )
      );
      continue;
    }

    const match = pickBestVhaCandidate(reportRow, candidates);
    if (!isPerfectFieldMatch(reportRow, match)) continue;
    if (match.completed_at) continue;

    updates.push({
      id: match.id,
      ...buildEpicConvertValidationPatch(match, options.importedAt, options.importedBy),
    });
  }

  return { inserts, updates };
}
