import type { EpicConversionInsertRow } from '../types';
import { EPIC_CONVERSION_HEADERS } from '../types';

function headerLookupKey(header: string): string {
  return header.trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeHeader(header: string): string {
  const key = headerLookupKey(header);
  if (key === 'care path') return 'CARE PATH';
  if (key === 'support tier') return 'SUPPORT TIER';
  if (key === 'ic lead') return 'IC LEAD';
  if (key === 'registration date') return 'REGISTRATION DATE';
  if (key === 'hosp dc date') return 'HOSP DC DATE';
  if (key === 'episode_conversion_strategy los' || key === 'episode conversion strategy los') {
    return 'EPISODE_CONVERSION_STRATEGY';
  }
  if (key === 'episode conversion strategy') return 'EPISODE_CONVERSION_STRATEGY';
  return header.trim().toUpperCase();
}

export function canonicalizeEpicHeaders(headers: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const h of headers) {
    if (!h.trim()) continue;
    map.set(normalizeHeader(h), h);
  }
  return map;
}

export function validateEpicConversionHeaders(headers: string[]): string[] {
  const errors: string[] = [];
  const canon = canonicalizeEpicHeaders(headers);
  const required = ['MRN'] as const;
  for (const req of required) {
    if (!canon.has(req)) errors.push(`Missing required column: ${req}`);
  }
  const missing = EPIC_CONVERSION_HEADERS.filter(
    (h) => !canon.has(h) && h !== 'LOS' && h !== 'ENROLL ID'
  );
  if (missing.length > 3) {
    errors.push(
      `Missing expected columns: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '…' : ''}`
    );
  }
  return errors;
}

export function pick(row: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const k of keys) {
    if (k in row && row[k] !== undefined && row[k] !== '') return row[k];
  }
  const byKey = new Map(
    Object.keys(row).map((key) => [headerLookupKey(key), key] as const)
  );
  for (const k of keys) {
    const actual = byKey.get(headerLookupKey(k));
    if (actual !== undefined) {
      const v = row[actual];
      if (v !== undefined && v !== '') return v;
    }
  }
  return undefined;
}

export function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s || null;
}

function parseIntField(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v);
  const n = parseInt(String(v).replace(/[^\d-]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(year, month, 0).getDate();
}

function toIsoDateString(year: number, month: number, day: number): string | null {
  if (!isValidCalendarDate(year, month, day)) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Excel stores dates as serial numbers (days since 1899-12-30 in the 1900
 * date system). Convert plausible serials to an ISO date string.
 */
function excelSerialToIso(serial: number): string | null {
  if (!Number.isFinite(serial)) return null;
  // Plausible range: ~1950 (18262) to ~2100 (73050). Avoids treating small
  // numbers (e.g. day counts) as dates.
  if (serial < 18262 || serial > 73050) return null;
  const epoch = Date.UTC(1899, 11, 30);
  const ms = epoch + Math.round(serial) * 86400000;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export function parseDate(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    // Use local calendar parts to avoid a UTC day-shift on midnight dates.
    return toIsoDateString(
      raw.getFullYear(),
      raw.getMonth() + 1,
      raw.getDate()
    );
  }
  if (typeof raw === 'number') {
    return excelSerialToIso(raw);
  }
  const s = String(raw).trim();
  if (!s) return null;

  // Bare numeric value (Excel serial that arrived as a string).
  if (/^\d+(\.\d+)?$/.test(s)) {
    const serial = excelSerialToIso(parseFloat(s));
    if (serial) return serial;
  }

  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    return toIsoDateString(
      parseInt(iso[1], 10),
      parseInt(iso[2], 10),
      parseInt(iso[3], 10)
    );
  }

  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) {
    const day = parseInt(dmy[1], 10);
    const month = parseInt(dmy[2], 10);
    const year = parseInt(dmy[3], 10);
    return toIsoDateString(year, month, day);
  }

  return null;
}

export function mapEpicConversionRow(
  row: Record<string, unknown>,
  sourceFilename: string
): EpicConversionInsertRow | null {
  const mrn = str(pick(row, ['MRN', 'mrn']));
  if (!mrn) return null;

  const strategyRaw = pick(row, [
    'EPISODE_CONVERSION_STRATEGY',
    'EPISODE_CONVERSION_STRATEGY LOS',
    'Episode Conversion Strategy',
  ]);
  const losRaw = pick(row, ['LOS', 'los']);

  return {
    enroll_id: str(pick(row, ['ENROLL ID', 'Enroll ID'])),
    gcn: str(pick(row, ['GCN', 'gcn'])),
    mrn,
    pathway: str(pick(row, ['PATHWAY', 'pathway'])),
    care_path: str(pick(row, ['CARE PATH', 'Care Path', 'care path'])),
    support_tier: str(pick(row, ['SUPPORT TIER', 'Support Tier'])),
    ic_lead: str(pick(row, ['IC LEAD', 'IC Lead'])),
    registration_date: parseDate(pick(row, ['REGISTRATION DATE', 'Registration Date'])),
    hosp_dc_date: parseDate(pick(row, ['HOSP DC DATE', 'Hosp DC Date'])),
    episode_conversion_strategy: str(strategyRaw),
    los: str(losRaw),
    los_category: str(pick(row, ['LOS_CATEGORY', 'LOS Category'])),
    latest_srv: str(pick(row, ['LATEST_SRV', 'Latest Srv'])),
    days_since_lvd: parseIntField(pick(row, ['DAYS_SINCE_LVD', 'Days Since LVD'])),
    lvd: parseDate(pick(row, ['LVD', 'lvd'])),
    lvt: str(pick(row, ['LVT', 'lvt'])),
    source_filename: sourceFilename,
  };
}

export function mapEpicConversionRows(
  rows: Record<string, unknown>[],
  sourceFilename: string
): { rows: EpicConversionInsertRow[]; skipped: number } {
  let skipped = 0;
  const mapped: EpicConversionInsertRow[] = [];
  for (const row of rows) {
    const m = mapEpicConversionRow(row, sourceFilename);
    if (m) mapped.push(m);
    else skipped += 1;
  }
  return { rows: mapped, skipped };
}
