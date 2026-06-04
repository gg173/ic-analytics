import * as XLSX from 'xlsx';
import { downloadWorkbook } from '../../export/excelExport';
import type { EpicCarePlanRow } from '../carePlan/types';

const CARE_PLAN_IMPORT_HEADERS = [
  'BRN',
  'Client ID',
  'Offer ID',
  'GoldCare ID',
  'Patient Name',
  'Client Needs/Goals',
  'Service/Teaching Plan',
  'Outcomes',
  'Goal Met',
  'Date Saved',
] as const;

function carePlanRowToSheetRow(r: EpicCarePlanRow): Record<string, string | null> {
  return {
    BRN: r.brn,
    'Client ID': r.client_id,
    'Offer ID': r.offer_id,
    'GoldCare ID': r.goldcare_id,
    'Patient Name': r.patient_name,
    'Client Needs/Goals': r.client_needs_goals,
    'Service/Teaching Plan': r.service_teaching_plan,
    Outcomes: r.outcomes,
    'Goal Met': r.goal_met,
    'Date Saved': r.date_saved,
  };
}

export function downloadCarePlanImportXlsx(
  rows: EpicCarePlanRow[],
  filename: string
): void {
  const sheetRows = rows.map(carePlanRowToSheetRow);
  const ws = sheetRows.length
    ? XLSX.utils.json_to_sheet(sheetRows, { header: [...CARE_PLAN_IMPORT_HEADERS] })
    : XLSX.utils.aoa_to_sheet([['No rows in this import.']]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Care Plan Templates');
  downloadWorkbook(wb, filename);
}
