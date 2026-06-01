import * as XLSX from 'xlsx';
import {
  mapEpicConversionRows,
  validateEpicConversionHeaders,
} from './mapEpicConversionRow';
import {
  isVhaSsdbExport,
  mapVhaSsdbRows,
  validateVhaSsdbHeaders,
} from './transformVhaSsdbEnrolment';

export interface EpicConversionParseResult {
  rows: ReturnType<typeof mapEpicConversionRows>['rows'];
  skipped: number;
  duplicateEnrollIds: number;
  /** True when the workbook is a VHA SSDB export (ENROLL ID + ENROLL STATUS). */
  isVhaSsdb: boolean;
  errors: string[];
}

/**
 * Parse the first sheet keeping RAW cell values: date cells stay as Excel
 * serial numbers and text stays as strings. This avoids locale-formatted date
 * strings (ambiguous) and timezone shifts from JS Date conversion. The row
 * mapper (parseDate) normalizes Excel serials and ISO/dmy strings in UTC.
 */
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

const emptyResult = (errors: string[], isVhaSsdb = false): EpicConversionParseResult => ({
  rows: [],
  skipped: 0,
  duplicateEnrollIds: 0,
  isVhaSsdb,
  errors,
});

export function parseEpicConversionXlsxBuffer(
  buf: ArrayBuffer,
  filename: string,
  referenceDate: Date = new Date()
): EpicConversionParseResult {
  const parsed = parseRawSheet(buf);
  const errors = [...parsed.errors];
  if (!parsed.rows.length) {
    errors.push('No data rows found in the spreadsheet');
    return emptyResult(errors);
  }

  if (isVhaSsdbExport(parsed.headers)) {
    const headerErrors = validateVhaSsdbHeaders(parsed.headers);
    errors.push(...headerErrors);
    if (headerErrors.length) {
      return emptyResult(errors, true);
    }

    const { rows, skipped } = mapVhaSsdbRows(parsed.rows, filename, referenceDate);
    if (!rows.length) {
      errors.push('No valid rows (each ACTIVE row needs an ENROLL ID and MRN)');
    }
    return { rows, skipped, duplicateEnrollIds: 0, isVhaSsdb: true, errors };
  }

  const headerErrors = validateEpicConversionHeaders(parsed.headers);
  errors.push(...headerErrors);
  if (headerErrors.length) {
    return emptyResult(errors);
  }

  const { rows, skipped } = mapEpicConversionRows(parsed.rows, filename);
  if (!rows.length) {
    errors.push('No valid rows (each row needs an MRN)');
  }

  return { rows, skipped, duplicateEnrollIds: 0, isVhaSsdb: false, errors };
}
