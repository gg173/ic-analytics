import { parseSsdbServiceSheet } from './parseSsdbServiceSheet';
import {
  isVhaSsdbServiceExport,
  mapVhaSsdbServiceRows,
  validateVhaSsdbServiceHeaders,
} from './transformVhaSsdbService';
import type { SsdbServiceParsedRow } from '../serviceData/types';

export interface SsdbServiceParseResult {
  rows: SsdbServiceParsedRow[];
  skipped: number;
  errors: string[];
}

export function parseVhaSsdbServiceXlsxBuffer(buf: ArrayBuffer): SsdbServiceParseResult {
  const parsed = parseSsdbServiceSheet(buf);
  const errors = [...parsed.errors];
  if (!parsed.rows.length) {
    errors.push('No data rows found in the spreadsheet');
    return { rows: [], skipped: 0, errors };
  }

  if (!isVhaSsdbServiceExport(parsed.headers)) {
    errors.push('Unrecognized VHA SSDB Service export (expected ENROLL ID and CALENDAR KEY columns)');
    return { rows: [], skipped: 0, errors };
  }

  const headerErrors = validateVhaSsdbServiceHeaders(parsed.headers);
  errors.push(...headerErrors);
  if (headerErrors.length) {
    return { rows: [], skipped: 0, errors };
  }

  const { rows, skipped } = mapVhaSsdbServiceRows(parsed.rows);
  if (!rows.length) {
    errors.push('No valid rows (each row needs ENROLL ID, MRN, and CALENDAR KEY)');
  }

  return { rows, skipped, errors };
}
