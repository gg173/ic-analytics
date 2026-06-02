import * as XLSX from 'xlsx';
import { downloadWorkbook } from '../../export/excelExport';
import type { EpicConversionRecord } from '../types';

export const SUBMITTED_DISCHARGES_HEADERS = [
  'GC#',
  'MRN',
  'PATHWAY',
  'CAREPATH',
  'PROG DC DATE',
  'PROG DC REASON',
  'SUBMITTED BY',
] as const;

function submittedByDisplay(email: string | null | undefined): string {
  if (!email) return 'unknown';
  return email.split('@')[0];
}

function recordToSheetRow(
  r: EpicConversionRecord
): Record<(typeof SUBMITTED_DISCHARGES_HEADERS)[number], string | null> {
  return {
    'GC#': r.gcn,
    MRN: r.mrn,
    PATHWAY: r.pathway,
    CAREPATH: r.care_path,
    'PROG DC DATE': r.discharge_date,
    'PROG DC REASON': r.discharge_reason,
    'SUBMITTED BY': submittedByDisplay(r.discharged_by),
  };
}

export function downloadSubmittedDischargesXlsx(
  records: EpicConversionRecord[],
  filename: string
): void {
  const sheetRows = records.map(recordToSheetRow);
  const ws = sheetRows.length
    ? XLSX.utils.json_to_sheet(sheetRows, { header: [...SUBMITTED_DISCHARGES_HEADERS] })
    : XLSX.utils.aoa_to_sheet([['No submitted discharges to export.']]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Submitted Discharges');
  downloadWorkbook(wb, filename);
}
