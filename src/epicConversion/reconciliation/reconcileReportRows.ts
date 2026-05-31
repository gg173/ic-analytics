import type { EpicConversionRecord } from '../types';
import type {
  EpicConversionReportRow,
  ReconciliationCompareField,
  ReconciliationDetailRow,
  ReconciliationOutcome,
} from './types';

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function normalizeDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const d = new Date(`${trimmed}T12:00:00`);
  if (Number.isNaN(d.getTime())) return normalizeText(trimmed) || null;
  return d.toISOString().slice(0, 10);
}

export function compareReconciliationFields(
  reportRow: EpicConversionReportRow,
  record: EpicConversionRecord
): ReconciliationCompareField[] {
  const discrepancies: ReconciliationCompareField[] = [];

  if (normalizeText(reportRow.mrn) !== normalizeText(record.mrn)) {
    discrepancies.push('mrn');
  }
  if (normalizeText(reportRow.pathway) !== normalizeText(record.pathway)) {
    discrepancies.push('pathway');
  }
  if (normalizeDate(reportRow.hosp_dc_date) !== normalizeDate(record.hosp_dc_date)) {
    discrepancies.push('hosp_dc_date');
  }
  if (normalizeText(reportRow.ic_lead) !== normalizeText(record.ic_lead)) {
    discrepancies.push('ic_lead');
  }

  return discrepancies;
}

function matchScore(
  reportRow: EpicConversionReportRow,
  record: EpicConversionRecord
): number {
  let score = 0;
  if (reportRow.enroll_id && record.enroll_id && reportRow.enroll_id === record.enroll_id) {
    score += 100;
  }
  if (normalizeText(reportRow.mrn) === normalizeText(record.mrn)) score += 10;
  if (normalizeText(reportRow.pathway) === normalizeText(record.pathway)) score += 4;
  if (normalizeDate(reportRow.hosp_dc_date) === normalizeDate(record.hosp_dc_date)) score += 2;
  if (normalizeText(reportRow.ic_lead) === normalizeText(record.ic_lead)) score += 1;
  return score;
}

export interface ReconciliationRunRow {
  report_row_id: string;
  matched_record_id: string | null;
  outcome: ReconciliationOutcome;
  field_discrepancies: string[];
}

export function reconcileReportRows(
  reportRows: EpicConversionReportRow[],
  convertedRecords: EpicConversionRecord[]
): ReconciliationRunRow[] {
  const convertedByMrn = new Map<string, EpicConversionRecord[]>();
  for (const record of convertedRecords) {
    const key = normalizeText(record.mrn);
    if (!key) continue;
    const list = convertedByMrn.get(key) ?? [];
    list.push(record);
    convertedByMrn.set(key, list);
  }

  return reportRows.map((reportRow) => {
    const mrnKey = normalizeText(reportRow.mrn);
    const candidates = mrnKey ? (convertedByMrn.get(mrnKey) ?? []) : [];

    if (!candidates.length) {
      return {
        report_row_id: reportRow.id,
        matched_record_id: null,
        outcome: 'unmatched' as const,
        field_discrepancies: [],
      };
    }

    let bestMatch = candidates[0];
    let bestScore = matchScore(reportRow, bestMatch);
    for (let i = 1; i < candidates.length; i += 1) {
      const score = matchScore(reportRow, candidates[i]);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = candidates[i];
      }
    }

    const discrepancies = compareReconciliationFields(reportRow, bestMatch);
    return {
      report_row_id: reportRow.id,
      matched_record_id: bestMatch.id,
      outcome: discrepancies.length === 0 ? ('perfect' as const) : ('incorrect' as const),
      field_discrepancies: discrepancies,
    };
  });
}

export function buildReconciliationDetails(
  reportRows: EpicConversionReportRow[],
  results: ReconciliationRunRow[],
  recordsById: Map<string, EpicConversionRecord>
): ReconciliationDetailRow[] {
  const resultsByRowId = new Map(results.map((r) => [r.report_row_id, r]));

  return reportRows.map((row) => {
    const result = resultsByRowId.get(row.id);
    const matched = result?.matched_record_id
      ? recordsById.get(result.matched_record_id)
      : undefined;

    return {
      reportRowId: row.id,
      rowIndex: row.row_index,
      mrn: row.mrn,
      pathway: row.pathway,
      hospDcDate: row.hosp_dc_date,
      icLead: row.ic_lead,
      outcome: result?.outcome ?? 'unmatched',
      fieldDiscrepancies: result?.field_discrepancies ?? [],
      matchedRecordId: result?.matched_record_id ?? null,
      matchedMrn: matched?.mrn ?? null,
      matchedPathway: matched?.pathway ?? null,
      matchedHospDcDate: matched?.hosp_dc_date ?? null,
      matchedIcLead: matched?.ic_lead ?? null,
    };
  });
}
