import * as XLSX from 'xlsx';
import { downloadWorkbook } from '../../export/excelExport';
import type { EpicSsdbService } from '../serviceData/types';

const HEADERS = [
  'CALENDAR KEY',
  'ENROLL ID',
  'GCN',
  'MRN',
  'REGION',
  'SUBREGION',
  'FSA',
  'PATHWAY',
  'CAREPATH',
  'REG DATE',
  'HOSP DC DATE',
  'SRV DATE',
  'SRV DATE (PDD)',
  'SRV DISCPLINE',
  'PROGRAM',
  'SRV CODE',
  'SRV CODE DESCRIPTION',
  'SRV STATUS',
  'SRV DELIVERY MODE',
  'SRV Tx CODE(S)',
  'SRV PROVIDER ID',
  'SRV PROVIDER DESIGNATION',
  'START TIME',
  'END TIME',
  'WORKED DURATION',
  'INGEST STATUS',
] as const;

function serviceToSheetRow(row: EpicSsdbService): Record<string, string | null> {
  return {
    'CALENDAR KEY': row.calendar_key,
    'ENROLL ID': row.enroll_id,
    GCN: row.gcn,
    MRN: row.mrn,
    REGION: row.region,
    SUBREGION: row.subregion,
    FSA: row.fsa,
    PATHWAY: row.pathway,
    CAREPATH: row.carepath,
    'REG DATE': row.reg_date,
    'HOSP DC DATE': row.hosp_dc_date,
    'SRV DATE': row.srv_date,
    'SRV DATE (PDD)': row.srv_date_pdd,
    'SRV DISCPLINE': row.srv_discipline,
    PROGRAM: row.program,
    'SRV CODE': row.srv_code,
    'SRV CODE DESCRIPTION': row.srv_code_description,
    'SRV STATUS': row.srv_status,
    'SRV DELIVERY MODE': row.srv_delivery_mode,
    'SRV Tx CODE(S)': row.srv_tx_codes,
    'SRV PROVIDER ID': row.srv_provider_id,
    'SRV PROVIDER DESIGNATION': row.srv_provider_designation,
    'START TIME': row.start_time,
    'END TIME': row.end_time,
    'WORKED DURATION': row.worked_duration,
    'INGEST STATUS': row.ingest_status,
  };
}

export function downloadSsdbServiceImportXlsx(
  rows: EpicSsdbService[],
  filename: string
): void {
  const sheetRows = rows.map(serviceToSheetRow);
  const ws = sheetRows.length
    ? XLSX.utils.json_to_sheet(sheetRows, { header: [...HEADERS] })
    : XLSX.utils.aoa_to_sheet([['No rows in this import.']]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Service Data');
  downloadWorkbook(wb, filename);
}
