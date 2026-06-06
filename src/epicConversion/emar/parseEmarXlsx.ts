import * as XLSX from 'xlsx';
import {
  hasHeaderAlias,
  missingHeaderErrors,
  normalizedHeaderSet,
  validateImportRowCount,
} from '../ingest/importLimits';
import { parseDate, pick, str } from '../ingest/mapEpicConversionRow';
import { dedupeEmarInsertRows } from './emarDedup';
import type { EmarInsertRow } from './types';

const EMAR_HEADER_ALIASES: Record<string, string[]> = {
  BRN: ['BRN', 'brn'],
  'Client ID': ['Client ID', 'CLIENT ID', 'client id'],
  'Offer ID': ['Offer ID', 'OFFER ID', 'offer id'],
  'GoldCare ID': ['GoldCare ID', 'Goldcare ID', 'GOLDCARE ID', 'goldcare id', 'GC #', 'GC#'],
  'Medication Name': ['Medication Name', 'MEDICATION NAME', 'medication name'],
  'Last Admin Date/Time': [
    'Last Admin Date/Time',
    'Last Admin Date / Time',
    'LAST ADMIN DATE/TIME',
  ],
  Dose: ['Dose', 'DOSE', 'dose'],
  Route: ['Route', 'ROUTE', 'route'],
  Frequency: ['Frequency', 'FREQUENCY', 'frequency'],
  'Total Number of Doses': [
    'Total Number of Doses',
    'TOTAL NUMBER OF DOSES',
    'total number of doses',
  ],
  'Order or Dispensed Date': [
    'Order or Dispensed Date',
    'ORDER OR DISPENSED DATE',
    'order or dispensed date',
  ],
  'End Date': ['End Date', 'END DATE', 'end date'],
};

export const EMAR_REQUIRED_HEADERS = Object.keys(EMAR_HEADER_ALIASES);

function headerLookupKey(header: string): string {
  return header.trim().toLowerCase().replace(/\s+/g, ' ');
}

function buildHeaderMap(headers: string[]): Map<string, string> {
  const byKey = new Map<string, string>();
  for (const h of headers) {
    if (!h.trim()) continue;
    byKey.set(headerLookupKey(h), h);
  }

  const canonical = new Map<string, string>();
  for (const [canonicalName, aliases] of Object.entries(EMAR_HEADER_ALIASES)) {
    for (const alias of aliases) {
      const actual = byKey.get(headerLookupKey(alias));
      if (actual) {
        canonical.set(canonicalName, actual);
        break;
      }
    }
  }
  return canonical;
}

export function validateEmarHeaders(headers: string[]): string[] {
  return missingHeaderErrors(
    headers,
    Object.entries(EMAR_HEADER_ALIASES).map(([label, aliases]) => ({
      label,
      aliases,
    }))
  );
}

export function isEmarExport(headers: string[]): boolean {
  const normalized = normalizedHeaderSet(headers);
  return hasHeaderAlias(normalized, EMAR_HEADER_ALIASES['Medication Name']);
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

function parseDateTime(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return raw.toISOString();
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    if (raw >= 18262 && raw <= 73051) {
      const epoch = Date.UTC(1899, 11, 30);
      const ms = epoch + raw * 86400000;
      const d = new Date(ms);
      if (!Number.isNaN(d.getTime())) return d.toISOString();
    }
    return null;
  }

  const s = String(raw).trim();
  if (!s) return null;

  const parsed = Date.parse(s);
  if (!Number.isNaN(parsed)) {
    return new Date(parsed).toISOString();
  }

  const dateOnly = parseDate(raw);
  if (dateOnly) return `${dateOnly}T12:00:00.000Z`;

  return s;
}

function mapEmarRow(
  row: Record<string, unknown>,
  headerMap: Map<string, string>,
  rowIndex: number
): EmarInsertRow | null {
  const brn = str(pick(row, [headerMap.get('BRN') ?? 'BRN']));
  if (!brn) return null;

  return {
    brn,
    client_id: str(pick(row, [headerMap.get('Client ID') ?? 'Client ID'])),
    offer_id: str(pick(row, [headerMap.get('Offer ID') ?? 'Offer ID'])),
    goldcare_id: str(pick(row, [headerMap.get('GoldCare ID') ?? 'GoldCare ID'])),
    medication_name: str(pick(row, [headerMap.get('Medication Name') ?? 'Medication Name'])),
    last_admin_at: parseDateTime(
      pick(row, [headerMap.get('Last Admin Date/Time') ?? 'Last Admin Date/Time'])
    ),
    dose: str(pick(row, [headerMap.get('Dose') ?? 'Dose'])),
    route: str(pick(row, [headerMap.get('Route') ?? 'Route'])),
    frequency: str(pick(row, [headerMap.get('Frequency') ?? 'Frequency'])),
    total_number_of_doses: str(
      pick(row, [headerMap.get('Total Number of Doses') ?? 'Total Number of Doses'])
    ),
    order_or_dispensed_date: parseDate(
      pick(row, [headerMap.get('Order or Dispensed Date') ?? 'Order or Dispensed Date'])
    ),
    end_date: parseDate(pick(row, [headerMap.get('End Date') ?? 'End Date'])),
    row_index: rowIndex,
  };
}

export interface EmarParseResult {
  rows: EmarInsertRow[];
  skipped: number;
  skippedDuplicates: number;
  errors: string[];
}

export function parseEmarXlsxBuffer(buf: ArrayBuffer): EmarParseResult {
  const parsed = parseRawSheet(buf);
  const errors = [...parsed.errors];

  const rowLimitError = validateImportRowCount(parsed.rows.length);
  if (rowLimitError) errors.push(rowLimitError);

  if (!parsed.headers.length) {
    return { rows: [], skipped: 0, skippedDuplicates: 0, errors };
  }

  if (rowLimitError) {
    return { rows: [], skipped: 0, skippedDuplicates: 0, errors };
  }

  const headerErrors = validateEmarHeaders(parsed.headers);
  if (headerErrors.length) {
    return { rows: [], skipped: 0, skippedDuplicates: 0, errors: [...errors, ...headerErrors] };
  }

  const headerMap = buildHeaderMap(parsed.headers);
  const rows: EmarInsertRow[] = [];
  let skipped = 0;

  parsed.rows.forEach((row, index) => {
    const mapped = mapEmarRow(row, headerMap, index);
    if (!mapped) {
      skipped += 1;
      return;
    }
    rows.push(mapped);
  });

  if (!rows.length && !errors.length) {
    errors.push('No eMAR rows found in file');
  }

  const { rows: dedupedRows, skippedDuplicates } = dedupeEmarInsertRows(rows);
  return { rows: dedupedRows, skipped, skippedDuplicates, errors };
}
