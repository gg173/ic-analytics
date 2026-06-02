import type { EpicConversionRecord } from '../types';
import { iclNamesMatch } from './epicIclMatch';
import {
  getVhaWorkflowStatus,
  isMatchedStatusDiscrepancy,
  describeStatusDiscrepancy,
  VHA_WORKFLOW_STATUS_LABELS,
} from './recordWorkflow';
import type {
  EpicConversionReportRow,
  ReconciliationCompareField,
  ReconciliationDetailRow,
  ReconciliationOutcome,
  ReconciliationOutcomeFilter,
  ReconciliationSummary,
} from './types';
import { RECONCILIATION_FIELD_LABELS, RECONCILIATION_OUTCOME_LABELS } from './types';

export function normalizeMrnForMatch(mrn: string): string {
  const digits = mrn.trim().replace(/\D/g, '');
  if (!digits) return mrn.trim().toLowerCase();
  return digits.replace(/^0+/, '') || '0';
}

function normalizePathway(value: string | null | undefined): string {
  return (value ?? '').trim().toUpperCase();
}

export function compareReconciliationFields(
  reportRow: Pick<EpicConversionReportRow, 'mrn' | 'pathway' | 'ic_lead'>,
  record: Pick<EpicConversionRecord, 'mrn' | 'pathway' | 'ic_lead'>
): ReconciliationCompareField[] {
  const discrepancies: ReconciliationCompareField[] = [];

  if (normalizeMrnForMatch(reportRow.mrn) !== normalizeMrnForMatch(record.mrn)) {
    discrepancies.push('mrn');
  }

  const pathwayMatch =
    !!reportRow.pathway &&
    !!record.pathway &&
    normalizePathway(reportRow.pathway) === normalizePathway(record.pathway);
  if (!pathwayMatch) {
    discrepancies.push('pathway');
  }

  const iclMatch =
    !!reportRow.ic_lead && !!record.ic_lead && iclNamesMatch(reportRow.ic_lead, record.ic_lead);
  if (!iclMatch) {
    discrepancies.push('ic_lead');
  }

  return discrepancies;
}

export function isPerfectFieldMatch(
  reportRow: Pick<EpicConversionReportRow, 'mrn' | 'pathway' | 'ic_lead'>,
  record: Pick<EpicConversionRecord, 'mrn' | 'pathway' | 'ic_lead'>
): boolean {
  return compareReconciliationFields(reportRow, record).length === 0;
}

function partialMatchScore(
  reportRow: Pick<EpicConversionReportRow, 'pathway' | 'ic_lead'>,
  record: EpicConversionRecord
): number {
  let score = 0;
  if (
    reportRow.pathway &&
    normalizePathway(reportRow.pathway) === normalizePathway(record.pathway)
  ) {
    score += 4;
  }
  if (reportRow.ic_lead && iclNamesMatch(reportRow.ic_lead, record.ic_lead)) {
    score += 2;
  }
  if (record.completed_at) score += 1;
  return score;
}

function pickBestCandidate(
  reportRow: EpicConversionReportRow,
  candidates: EpicConversionRecord[]
): EpicConversionRecord {
  const perfectMatches = candidates.filter((record) => isPerfectFieldMatch(reportRow, record));
  if (perfectMatches.length) {
    const converted = perfectMatches.find((record) => record.completed_at);
    return converted ?? perfectMatches[0];
  }

  let best = candidates[0];
  let bestScore = partialMatchScore(reportRow, best);
  for (let i = 1; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    const score = partialMatchScore(reportRow, candidate);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

function classifyMatch(
  reportRow: EpicConversionReportRow,
  record: EpicConversionRecord
): { outcome: ReconciliationOutcome; field_discrepancies: ReconciliationCompareField[] } {
  const fieldDiscrepancies = compareReconciliationFields(reportRow, record);

  if (fieldDiscrepancies.length > 0) {
    return { outcome: 'field_discrepancy', field_discrepancies: fieldDiscrepancies };
  }

  if (isMatchedStatusDiscrepancy(record)) {
    return { outcome: 'status_discrepancy', field_discrepancies: [] };
  }

  return { outcome: 'validated', field_discrepancies: [] };
}

export interface ReconciliationRunRow {
  report_row_id: string;
  matched_record_id: string | null;
  outcome: ReconciliationOutcome;
  field_discrepancies: string[];
}

export function reconcileReportRows(
  reportRows: EpicConversionReportRow[],
  vhaRecords: EpicConversionRecord[]
): ReconciliationRunRow[] {
  const recordsByMrn = new Map<string, EpicConversionRecord[]>();
  for (const record of vhaRecords) {
    const key = normalizeMrnForMatch(record.mrn);
    if (!key) continue;
    const list = recordsByMrn.get(key) ?? [];
    list.push(record);
    recordsByMrn.set(key, list);
  }

  return reportRows.map((reportRow) => {
    const mrnKey = normalizeMrnForMatch(reportRow.mrn);
    const candidates = mrnKey ? (recordsByMrn.get(mrnKey) ?? []) : [];

    if (!candidates.length) {
      return {
        report_row_id: reportRow.id,
        matched_record_id: null,
        outcome: 'unmatched' as const,
        field_discrepancies: ['mrn'],
      };
    }

    const bestMatch = pickBestCandidate(reportRow, candidates);
    const { outcome, field_discrepancies } = classifyMatch(reportRow, bestMatch);

    return {
      report_row_id: reportRow.id,
      matched_record_id: bestMatch.id,
      outcome,
      field_discrepancies,
    };
  });
}

/**
 * Conversions completed after the most recent Epic report upload cannot be
 * adjudicated until the next upload; exclude them from discrepancy detection.
 */
export function isConversionPendingEpicAdjudication(
  record: Pick<EpicConversionRecord, 'completed_at'>,
  latestEpicImportedAt: string | null | undefined
): boolean {
  if (!latestEpicImportedAt || !record.completed_at) return false;
  return record.completed_at > latestEpicImportedAt;
}

export function getLatestEpicImportedAt(importedAts: Iterable<string>): string | null {
  let latest: string | null = null;
  for (const importedAt of importedAts) {
    if (!latest || importedAt > latest) latest = importedAt;
  }
  return latest;
}

/** Unmatched Epic rows cleared because the patient no longer appears in the latest report. */
export function countUnmatchedResolvedByLatestEpicUpload(
  previousUnmatchedRows: ReconciliationDetailRow[],
  latestEpicSnapshot: EpicConversionReportRow[]
): number {
  const mrnsInLatestReport = new Set<string>();
  for (const row of latestEpicSnapshot) {
    const key = normalizeMrnForMatch(row.mrn);
    if (key) mrnsInLatestReport.add(key);
  }

  return previousUnmatchedRows.filter((row) => {
    if (row.outcome !== 'unmatched') return false;
    const key = normalizeMrnForMatch(row.mrn);
    return !!key && !mrnsInLatestReport.has(key);
  }).length;
}

export function isDiscrepancyOutcome(outcome: ReconciliationOutcome): boolean {
  return outcome !== 'validated' && outcome !== 'perfect';
}

/** Whether a reconciliation row should surface as a discrepancy in the UI. */
export function isEpicReconciliationDiscrepancy(
  row: ReconciliationDetailRow,
  recordsById: Map<string, EpicConversionRecord>,
  latestEpicImportedAt: string | null | undefined
): boolean {
  if (!isDiscrepancyOutcome(row.outcome)) return false;
  if (!row.matchedRecordId) return true;
  const record = recordsById.get(row.matchedRecordId);
  return !record || !isConversionPendingEpicAdjudication(record, latestEpicImportedAt);
}

/** Summary counts excluding conversions awaiting the next Epic upload. */
export function summarizeReconciliationOutcomesExcludingPendingAdjudication(
  details: ReconciliationDetailRow[],
  recordsById: Map<string, EpicConversionRecord>,
  latestEpicImportedAt: string | null | undefined
): Pick<
  ReconciliationSummary,
  'validated' | 'statusDiscrepancy' | 'fieldDiscrepancy' | 'unmatched' | 'missingFromEpic'
> {
  const rows = details
    .filter((row) => {
      if (!row.matchedRecordId) return true;
      const record = recordsById.get(row.matchedRecordId);
      return !record || !isConversionPendingEpicAdjudication(record, latestEpicImportedAt);
    })
    .map((row) => ({ outcome: row.outcome }));
  return summarizeReconciliationOutcomes(rows);
}

export function isValidatedOutcome(outcome: ReconciliationOutcome): boolean {
  return outcome === 'validated' || outcome === 'perfect';
}

export function matchesReconciliationOutcomeFilter(
  outcome: ReconciliationOutcome,
  filter: ReconciliationOutcomeFilter
): boolean {
  if (filter === 'all') return true;
  if (filter === 'validated') return isValidatedOutcome(outcome);
  if (filter === 'field_discrepancy') {
    return outcome === 'field_discrepancy' || outcome === 'incorrect';
  }
  if (filter === 'missing_from_epic') {
    return outcome === 'missing_from_epic';
  }
  return outcome === filter;
}

export function summarizeReconciliationOutcomes(
  rows: { outcome: ReconciliationOutcome }[]
): Pick<
  ReconciliationSummary,
  'validated' | 'statusDiscrepancy' | 'fieldDiscrepancy' | 'unmatched' | 'missingFromEpic'
> {
  const count = (outcome: ReconciliationOutcome) =>
    rows.filter((row) => row.outcome === outcome).length;

  return {
    validated: count('validated') + count('perfect'),
    statusDiscrepancy: count('status_discrepancy'),
    fieldDiscrepancy: count('field_discrepancy') + count('incorrect'),
    unmatched: count('unmatched'),
    missingFromEpic: count('missing_from_epic'),
  };
}

/** Converted VHA patients whose MRN does not appear in the merged Epic report snapshot. */
export function findConvertedRecordsMissingFromEpic(
  vhaRecords: EpicConversionRecord[],
  epicRows: EpicConversionReportRow[],
  latestEpicImportedAt?: string | null
): ReconciliationDetailRow[] {
  const epicMrns = new Set<string>();
  for (const row of epicRows) {
    const key = normalizeMrnForMatch(row.mrn);
    if (key) epicMrns.add(key);
  }

  const missing: ReconciliationDetailRow[] = [];
  for (const record of vhaRecords) {
    if (getVhaWorkflowStatus(record) !== 'converted') continue;
    if (isConversionPendingEpicAdjudication(record, latestEpicImportedAt)) continue;

    const key = normalizeMrnForMatch(record.mrn);
    if (!key || epicMrns.has(key)) continue;

    missing.push({
      reportRowId: `vha-missing:${record.id}`,
      rowIndex: missing.length,
      patientName: null,
      mrn: '',
      epicEpisode: null,
      pathway: null,
      icLead: null,
      outcome: 'missing_from_epic',
      fieldDiscrepancies: ['mrn'],
      matchedRecordId: record.id,
      matchedMrn: record.mrn,
      matchedPathway: record.pathway,
      matchedIcLead: record.ic_lead,
      matchedWorkflowStatus: VHA_WORKFLOW_STATUS_LABELS.converted,
      epicImportFilename: null,
      matchedCompletedAt: record.completed_at,
      matchedCompletedBy: record.completed_by,
      epicReportImportedAt: latestEpicImportedAt ?? null,
    });
  }

  return missing.sort((a, b) => (a.matchedMrn ?? '').localeCompare(b.matchedMrn ?? ''));
}

export function buildReconciliationDetails(
  reportRows: EpicConversionReportRow[],
  results: ReconciliationRunRow[],
  recordsById: Map<string, EpicConversionRecord>,
  importFilenameById?: Map<string, string>
): ReconciliationDetailRow[] {
  const resultsByRowId = new Map(results.map((r) => [r.report_row_id, r]));

  return reportRows.map((row) => {
    const result = resultsByRowId.get(row.id);
    const matched = result?.matched_record_id
      ? recordsById.get(result.matched_record_id)
      : undefined;
    const workflowStatus = matched ? getVhaWorkflowStatus(matched) : null;

    return {
      reportRowId: row.id,
      rowIndex: row.row_index,
      patientName: row.patient_name ?? null,
      mrn: row.mrn,
      epicEpisode: row.epic_episode ?? null,
      pathway: row.pathway,
      icLead: row.ic_lead,
      outcome: result?.outcome ?? 'unmatched',
      fieldDiscrepancies: result?.field_discrepancies ?? [],
      matchedRecordId: result?.matched_record_id ?? null,
      matchedMrn: matched?.mrn ?? null,
      matchedPathway: matched?.pathway ?? null,
      matchedIcLead: matched?.ic_lead ?? null,
      matchedWorkflowStatus: workflowStatus
        ? VHA_WORKFLOW_STATUS_LABELS[workflowStatus]
        : null,
      epicImportFilename: importFilenameById?.get(row.import_id) ?? null,
      matchedCompletedAt: matched?.completed_at ?? null,
      matchedCompletedBy: matched?.completed_by ?? null,
      epicReportImportedAt: null,
    };
  });
}

function formatReconciliationTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const month = d.toLocaleDateString('en-US', { month: 'short' });
  const hours = d.getHours().toString().padStart(2, '0');
  const minutes = d.getMinutes().toString().padStart(2, '0');
  return `${month} ${d.getDate()} ${hours}:${minutes}`;
}

function reconciliationActorUsername(value: string | null | undefined): string {
  if (!value?.trim()) return 'unknown';
  return value.includes('@') ? value.split('@')[0] : value.trim();
}

/** Result cell text for VHA-converted patients absent from the Epic report snapshot. */
export function formatMissingFromEpicResultSummary(row: ReconciliationDetailRow): string {
  const conversionPart = row.matchedCompletedAt
    ? `${formatReconciliationTimestamp(row.matchedCompletedAt)} by ${reconciliationActorUsername(row.matchedCompletedBy)}`
    : reconciliationActorUsername(row.matchedCompletedBy) !== 'unknown'
      ? `by ${reconciliationActorUsername(row.matchedCompletedBy)}`
      : '—';

  const epicPart = row.epicReportImportedAt
    ? formatReconciliationTimestamp(row.epicReportImportedAt)
    : '—';

  return `Marked Converted (${conversionPart}) but Not in Epic Conversion Report (${epicPart})`;
}

export interface EpicMatchedSnapshot {
  mrn: string;
  pathwayDisplay: string;
  icLead: string | null;
}

/** Epic report row linked to a VHA record (excludes missing-from-Epic synthetic rows). */
export function reconciliationRowHasEpicReportMatch(row: ReconciliationDetailRow): boolean {
  return (
    !!row.matchedRecordId &&
    row.outcome !== 'missing_from_epic' &&
    !row.reportRowId.startsWith('vha-missing:') &&
    !!row.mrn?.trim()
  );
}

export function epicPathwayDisplayForRow(row: ReconciliationDetailRow): string {
  return row.pathway?.trim() || row.epicEpisode?.trim() || '—';
}

/** Epic fields from the conversion report for each matched VHA record. */
export function buildEpicSnapshotByMatchedRecordId(
  unifiedDetails: ReconciliationDetailRow[]
): Map<string, EpicMatchedSnapshot> {
  const map = new Map<string, EpicMatchedSnapshot>();
  for (const row of unifiedDetails) {
    if (!reconciliationRowHasEpicReportMatch(row) || !row.matchedRecordId) continue;
    map.set(row.matchedRecordId, {
      mrn: row.mrn.trim(),
      pathwayDisplay: epicPathwayDisplayForRow(row),
      icLead: row.icLead?.trim() || null,
    });
  }
  return map;
}

export type EpicRecordValidationStatus =
  | { status: 'pending' }
  | { status: 'discrepancy'; detail: string }
  | { status: 'validated'; filename: string };

/** Human-readable discrepancy detail for a reconciliation row. */
export function describeReconciliationDiscrepancy(row: ReconciliationDetailRow): string {
  if (row.outcome === 'missing_from_epic') {
    return formatMissingFromEpicResultSummary(row);
  }

  if (row.outcome === 'status_discrepancy') {
    return describeStatusDiscrepancy(row.matchedWorkflowStatus);
  }

  if (row.outcome === 'field_discrepancy' || row.outcome === 'incorrect') {
    const parts = row.fieldDiscrepancies
      .map((field) => {
        const label = RECONCILIATION_FIELD_LABELS[field as ReconciliationCompareField];
        return label ? `${label} mismatch` : `${field} mismatch`;
      })
      .filter(Boolean);
    return parts.length ? parts.join('; ') : 'Field mismatch';
  }

  return RECONCILIATION_OUTCOME_LABELS[row.outcome] ?? 'Discrepancy';
}

/** Maps VHA record IDs to Epic validation status from unified reconciliation. */
export function buildEpicValidationStatusByRecordId(
  unifiedDetails: ReconciliationDetailRow[],
  hasEpicReports: boolean,
  options?: {
    recordsById?: Map<string, EpicConversionRecord>;
    latestEpicImportedAt?: string | null;
  }
): Map<string, EpicRecordValidationStatus> {
  const map = new Map<string, EpicRecordValidationStatus>();
  if (!hasEpicReports) return map;

  const { recordsById, latestEpicImportedAt } = options ?? {};

  for (const row of unifiedDetails) {
    if (!row.matchedRecordId) continue;

    const record = recordsById?.get(row.matchedRecordId);
    if (record && isConversionPendingEpicAdjudication(record, latestEpicImportedAt)) {
      continue;
    }

    if (isValidatedOutcome(row.outcome)) {
      map.set(row.matchedRecordId, {
        status: 'validated',
        filename: row.epicImportFilename ?? 'Epic conversion report',
      });
    } else if (isDiscrepancyOutcome(row.outcome)) {
      map.set(row.matchedRecordId, {
        status: 'discrepancy',
        detail: describeReconciliationDiscrepancy(row),
      });
    }
  }

  return map;
}
