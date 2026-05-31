import * as XLSX from 'xlsx';
import { downloadWorkbook } from '../../export/excelExport';
import type { EpicConversionRecord } from '../types';
import { EPIC_CONVERSION_HEADERS } from '../types';

function recordToSheetRow(r: EpicConversionRecord): Record<string, string | number | null> {
  return {
    'ENROLL ID': r.enroll_id,
    GCN: r.gcn,
    MRN: r.mrn,
    PATHWAY: r.pathway,
    'CARE PATH': r.care_path,
    'SUPPORT TIER': r.support_tier,
    'IC LEAD': r.ic_lead,
    'REGISTRATION DATE': r.registration_date,
    'HOSP DC DATE': r.hosp_dc_date,
    EPISODE_CONVERSION_STRATEGY: r.episode_conversion_strategy,
    LOS: r.los,
    LOS_CATEGORY: r.los_category,
    LATEST_SRV: r.latest_srv,
    DAYS_SINCE_LVD: r.days_since_lvd,
    LVD: r.lvd,
    LVT: r.lvt,
  };
}

export function downloadEnrolmentImportXlsx(
  records: EpicConversionRecord[],
  filename: string
): void {
  const rows = records.map(recordToSheetRow);
  const ws = rows.length
    ? XLSX.utils.json_to_sheet(rows, { header: [...EPIC_CONVERSION_HEADERS] })
    : XLSX.utils.aoa_to_sheet([['No rows in this import.']]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Enrolment');
  downloadWorkbook(wb, filename);
}
