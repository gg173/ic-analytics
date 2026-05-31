import * as XLSX from 'xlsx';
import { pick, str, parseDate } from '../ingest/mapEpicConversionRow';

export interface EpicReportParseRow {
  enroll_id: string | null;
  mrn: string;
  pathway: string | null;
  hosp_dc_date: string | null;
  ic_lead: string | null;
  row_index: number;
}

export interface EpicReportParseResult {
  rows: EpicReportParseRow[];
  skipped: number;
  errors: string[];
}

function parseRawSheet(buf: ArrayBuffer): {
  headers: string[];
  rows: Record<string, unknown>[];
  errors: string[];
} {
  const errors: string[] = [];
  const wb = XLSX.read(buf, { type: 'array' });
  const name = wb.SheetNames[0];
  if (!name) return { headers: [], rows: [], errors: ['Workbook has no sheets'] };

  const ws = wb.Sheets[name];
  const data = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    raw: true,
    defval: null,
  }) as unknown[][];

  if (!data.length) return { headers: [], rows: [], errors: [`Sheet "${name}" is empty`] };

  const headers = (data[0] as unknown[]).map((c) =>
    c === null || c === undefined ? '' : String(c).trim()
  );

  const rows: Record<string, unknown>[] = [];
  for (let r = 1; r < data.length; r++) {
    const row = data[r] as unknown[];
    if (!row || !row.some((c) => c !== null && c !== undefined && String(c).trim() !== '')) {
      continue;
    }
    const obj: Record<string, unknown> = {};
    headers.forEach((h, i) => {
      if (h) obj[h] = row[i];
    });
    rows.push(obj);
  }

  return { headers, rows, errors };
}

function mapReportRow(row: Record<string, unknown>, rowIndex: number): EpicReportParseRow | null {
  const mrn = str(pick(row, ['MRN', 'mrn']));
  if (!mrn) return null;

  return {
    enroll_id: str(pick(row, ['ENROLL ID', 'ENROLL_ID', 'enroll id'])),
    mrn,
    pathway: str(pick(row, ['PATHWAY', 'pathway'])),
    hosp_dc_date: parseDate(pick(row, ['HOSP DC DATE', 'HOSP_DC_DATE', 'hosp dc date'])),
    ic_lead: str(pick(row, ['IC LEAD', 'IC_LEAD', 'ic lead'])),
    row_index: rowIndex,
  };
}

export function parseEpicConversionReportBuffer(buf: ArrayBuffer): EpicReportParseResult {
  const parsed = parseRawSheet(buf);
  const errors = [...parsed.errors];

  if (!parsed.rows.length) {
    errors.push('No data rows found in the spreadsheet');
    return { rows: [], skipped: 0, errors };
  }

  const hasMrn = parsed.headers.some((h) => h.trim().toLowerCase().replace(/\s+/g, ' ') === 'mrn');
  if (!hasMrn) {
    errors.push('Missing required column: MRN');
    return { rows: [], skipped: 0, errors };
  }

  const rows: EpicReportParseRow[] = [];
  let skipped = 0;
  for (let i = 0; i < parsed.rows.length; i += 1) {
    const mapped = mapReportRow(parsed.rows[i], i + 2);
    if (mapped) rows.push(mapped);
    else skipped += 1;
  }

  if (!rows.length) {
    errors.push('No valid rows (each row needs an MRN)');
  }

  return { rows, skipped, errors };
}
