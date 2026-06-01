import * as XLSX from 'xlsx';
import { downloadWorkbook } from '../../export/excelExport';
import type { EpicConversionReportRow } from '../reconciliation/types';

const EPIC_REPORT_HEADERS = ['Patient', 'MRN', 'Episode', 'ICL/HCS Assigned'] as const;

function reportRowToSheetRow(r: EpicConversionReportRow): Record<string, string | null> {
  return {
    Patient: r.patient_name,
    MRN: r.mrn,
    Episode: r.epic_episode ?? r.pathway,
    'ICL/HCS Assigned': r.ic_lead,
  };
}

export function downloadEpicReportImportXlsx(
  rows: EpicConversionReportRow[],
  filename: string
): void {
  const sheetRows = rows.map(reportRowToSheetRow);
  const ws = sheetRows.length
    ? XLSX.utils.json_to_sheet(sheetRows, { header: [...EPIC_REPORT_HEADERS] })
    : XLSX.utils.aoa_to_sheet([['No rows in this import.']]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Epic Report');
  downloadWorkbook(wb, filename);
}
