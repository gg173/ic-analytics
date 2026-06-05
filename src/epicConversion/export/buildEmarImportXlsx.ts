import * as XLSX from 'xlsx';
import { downloadWorkbook } from '../../export/excelExport';
import type { EpicEmarRow } from '../emar/types';

const EMAR_IMPORT_HEADERS = [
  'BRN',
  'Client ID',
  'Offer ID',
  'GoldCare ID',
  'Medication Name',
  'Last Admin Date/Time',
  'Dose',
  'Route',
  'Frequency',
  'Total Number of Doses',
  'Order or Dispensed Date',
  'End Date',
] as const;

function emarRowToSheetRow(r: EpicEmarRow): Record<string, string | null> {
  return {
    BRN: r.brn,
    'Client ID': r.client_id,
    'Offer ID': r.offer_id,
    'GoldCare ID': r.goldcare_id,
    'Medication Name': r.medication_name,
    'Last Admin Date/Time': r.last_admin_at,
    Dose: r.dose,
    Route: r.route,
    Frequency: r.frequency,
    'Total Number of Doses': r.total_number_of_doses,
    'Order or Dispensed Date': r.order_or_dispensed_date,
    'End Date': r.end_date,
  };
}

export function downloadEmarImportXlsx(rows: EpicEmarRow[], filename: string): void {
  const sheetRows = rows.map(emarRowToSheetRow);
  const ws = sheetRows.length
    ? XLSX.utils.json_to_sheet(sheetRows, { header: [...EMAR_IMPORT_HEADERS] })
    : XLSX.utils.aoa_to_sheet([['No rows in this import.']]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'eMAR');
  downloadWorkbook(wb, filename);
}
