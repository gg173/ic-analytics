import * as XLSX from 'xlsx';
import { parseDate, pick, str } from '../ingest/mapEpicConversionRow';
import type { CarePlanInsertRow } from './types';

export const CARE_PLAN_REQUIRED_HEADERS = ['BRN'] as const;

const CARE_PLAN_HEADER_ALIASES: Record<string, string[]> = {
  BRN: ['BRN', 'brn'],
  'Client ID': ['Client ID', 'CLIENT ID', 'client id'],
  'Offer ID': ['Offer ID', 'OFFER ID', 'offer id'],
  'GoldCare ID': ['GoldCare ID', 'Goldcare ID', 'GOLDCARE ID', 'goldcare id', 'GC #', 'GC#'],
  'Patient Name': ['Patient Name', 'PATIENT NAME', 'patient name'],
  'Client Needs/Goals': [
    'Client Needs/Goals',
    'Client Needs / Goals',
    'CLIENT NEEDS/GOALS',
  ],
  'Service/Teaching Plan': [
    'Service/Teaching Plan',
    'Service / Teaching Plan',
    'SERVICE/TEACHING PLAN',
  ],
  Outcomes: ['Outcomes', 'OUTCOMES', 'outcomes'],
  'Goal Met': ['Goal Met', 'GOAL MET', 'goal met'],
  'Date Saved': ['Date Saved', 'DATE SAVED', 'date saved'],
};

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
  for (const [canonicalName, aliases] of Object.entries(CARE_PLAN_HEADER_ALIASES)) {
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

export function validateCarePlanHeaders(headers: string[]): string[] {
  const errors: string[] = [];
  const map = buildHeaderMap(headers);
  for (const required of CARE_PLAN_REQUIRED_HEADERS) {
    if (!map.has(required)) {
      errors.push(`Missing required column: ${required}`);
    }
  }
  return errors;
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

function mapCarePlanRow(
  row: Record<string, unknown>,
  headerMap: Map<string, string>,
  rowIndex: number
): CarePlanInsertRow | null {
  const brn = str(pick(row, [headerMap.get('BRN') ?? 'BRN']));
  if (!brn) return null;

  return {
    brn,
    client_id: str(pick(row, [headerMap.get('Client ID') ?? 'Client ID'])),
    offer_id: str(pick(row, [headerMap.get('Offer ID') ?? 'Offer ID'])),
    goldcare_id: str(pick(row, [headerMap.get('GoldCare ID') ?? 'GoldCare ID'])),
    patient_name: str(pick(row, [headerMap.get('Patient Name') ?? 'Patient Name'])),
    client_needs_goals: str(
      pick(row, [headerMap.get('Client Needs/Goals') ?? 'Client Needs/Goals'])
    ),
    service_teaching_plan: str(
      pick(row, [headerMap.get('Service/Teaching Plan') ?? 'Service/Teaching Plan'])
    ),
    outcomes: str(pick(row, [headerMap.get('Outcomes') ?? 'Outcomes'])),
    goal_met: str(pick(row, [headerMap.get('Goal Met') ?? 'Goal Met'])),
    date_saved: parseDate(pick(row, [headerMap.get('Date Saved') ?? 'Date Saved'])),
    row_index: rowIndex,
  };
}

export interface CarePlanParseResult {
  rows: CarePlanInsertRow[];
  skipped: number;
  errors: string[];
}

export function parseCarePlanXlsxBuffer(buf: ArrayBuffer): CarePlanParseResult {
  const parsed = parseRawSheet(buf);
  const errors = [...parsed.errors];
  if (!parsed.headers.length) {
    return { rows: [], skipped: 0, errors };
  }

  const headerErrors = validateCarePlanHeaders(parsed.headers);
  if (headerErrors.length) {
    return { rows: [], skipped: 0, errors: [...errors, ...headerErrors] };
  }

  const headerMap = buildHeaderMap(parsed.headers);
  const rows: CarePlanInsertRow[] = [];
  let skipped = 0;

  parsed.rows.forEach((row, index) => {
    const mapped = mapCarePlanRow(row, headerMap, index);
    if (!mapped) {
      skipped += 1;
      return;
    }
    rows.push(mapped);
  });

  if (!rows.length && !errors.length) {
    errors.push('No care plan rows found in file');
  }

  return { rows, skipped, errors };
}
