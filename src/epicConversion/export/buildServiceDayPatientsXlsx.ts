import * as XLSX from 'xlsx';
import { downloadWorkbook } from '../../export/excelExport';
import { formatVhaIcLeadDisplay } from '../reconciliation/epicIclMatch';
import type { ServiceDayPatient } from '../serviceData/linkServiceDayCarePlans';

const BASE_HEADERS = ['Service Date', 'MRN', 'Pathway', 'IC Lead'] as const;
const CP_TEMPLATE_HEADER = 'CP Template' as const;

export interface ServiceDayPatientExportRow extends ServiceDayPatient {
  serviceDate: string;
}

function formatServiceDate(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function rowToSheetRow(
  row: ServiceDayPatientExportRow,
  includeCpTemplate: boolean
): Record<string, string> {
  const sheetRow: Record<string, string> = {
    'Service Date': formatServiceDate(row.serviceDate),
    MRN: row.mrn?.trim() ?? '',
    Pathway: row.pathway?.trim() ?? '',
    'IC Lead': formatVhaIcLeadDisplay(row.icLead) ?? '',
  };
  if (includeCpTemplate) {
    sheetRow[CP_TEMPLATE_HEADER] = row.hasTemplatedCarePlan ? 'Yes' : 'No';
  }
  return sheetRow;
}

export function downloadServiceDayPatientsXlsx(
  rows: ServiceDayPatientExportRow[],
  filename: string,
  options: { includeCpTemplate: boolean }
): void {
  const headers = options.includeCpTemplate
    ? [...BASE_HEADERS, CP_TEMPLATE_HEADER]
    : [...BASE_HEADERS];
  const sheetRows = rows.map((row) => rowToSheetRow(row, options.includeCpTemplate));
  const ws = sheetRows.length
    ? XLSX.utils.json_to_sheet(sheetRows, { header: headers })
    : XLSX.utils.aoa_to_sheet([['No patients to export.']]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Service Day Patients');
  downloadWorkbook(wb, filename);
}
