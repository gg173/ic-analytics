import * as XLSX from 'xlsx';
import { downloadWorkbook } from '../../export/excelExport';
import { iclNamesMatch } from '../reconciliation/epicIclMatch';
import { epicPathwayMatchesVha } from '../reconciliation/epicPathwayMap';
import {
  formatMissingFromEpicResultSummary,
  normalizeMrnForMatch,
} from '../reconciliation/reconcileReportRows';
import { describeStatusDiscrepancy } from '../reconciliation/recordWorkflow';
import type { ReconciliationDetailRow } from '../reconciliation/types';

export const RECONCILIATION_EXPORT_HEADERS = [
  'VHA MRN',
  'Epic MRN',
  'VHA Pathway',
  'Epic Pathway',
  'VHA IC Lead',
  'Epic IC Lead',
  'Result',
] as const;

function mrnMatches(epicMrn: string, vhaMrn: string | null | undefined): boolean {
  if (!vhaMrn?.trim()) return false;
  return normalizeMrnForMatch(epicMrn) === normalizeMrnForMatch(vhaMrn);
}

function pathwayMatches(row: ReconciliationDetailRow): boolean {
  return epicPathwayMatchesVha(
    { pathway: row.pathway, epic_episode: row.epicEpisode },
    row.matchedPathway
  );
}

function iclMatches(
  epicIcl: string | null | undefined,
  vhaIcl: string | null | undefined
): boolean {
  if (!epicIcl?.trim() || !vhaIcl?.trim()) return false;
  return iclNamesMatch(epicIcl, vhaIcl);
}

function buildResultSummary(row: ReconciliationDetailRow): string {
  const epicMrn = row.mrn?.trim();
  const vhaMrn = row.matchedMrn?.trim();

  if (epicMrn && !vhaMrn) {
    return 'Patient Not in VHA System';
  }

  const parts: string[] = [];

  if (epicMrn && vhaMrn && !mrnMatches(row.mrn, row.matchedMrn)) {
    parts.push('MRN mismatch');
  }
  if (!pathwayMatches(row)) {
    parts.push('Pathway mismatch');
  }
  if (!iclMatches(row.icLead, row.matchedIcLead)) {
    parts.push('ICL mismatch');
  }
  if (row.outcome === 'status_discrepancy') {
    parts.push(describeStatusDiscrepancy(row.matchedWorkflowStatus));
  }
  if (row.outcome === 'missing_from_epic') {
    return formatMissingFromEpicResultSummary(row);
  }

  if (row.outcome === 'validated' || row.outcome === 'perfect') {
    return 'Validated';
  }

  return parts.length ? parts.join('; ') : '';
}

function rowToSheetRow(
  row: ReconciliationDetailRow
): Record<(typeof RECONCILIATION_EXPORT_HEADERS)[number], string> {
  return {
    'VHA MRN': row.matchedMrn?.trim() ?? '',
    'Epic MRN': row.mrn?.trim() ?? '',
    'VHA Pathway': row.matchedPathway?.trim() ?? '',
    'Epic Pathway': row.pathway?.trim() || row.epicEpisode?.trim() || '',
    'VHA IC Lead': row.matchedIcLead?.trim() ?? '',
    'Epic IC Lead': row.icLead?.trim() ?? '',
    Result: buildResultSummary(row),
  };
}

export function downloadReconciliationXlsx(
  rows: ReconciliationDetailRow[],
  filename: string
): void {
  const sheetRows = rows.map(rowToSheetRow);
  const ws = sheetRows.length
    ? XLSX.utils.json_to_sheet(sheetRows, { header: [...RECONCILIATION_EXPORT_HEADERS] })
    : XLSX.utils.aoa_to_sheet([['No records to export.']]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Episode Validation');
  downloadWorkbook(wb, filename);
}
