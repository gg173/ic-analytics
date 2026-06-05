import * as XLSX from 'xlsx';
import { normalizePatientId } from '../../identity/patientId';

export interface SrvAllocationRow {
  mrn: string;
  nursing_care_stream: string | null;
  psw_care_stream: string | null;
  patient_name: string | null;
  episode_type: string | null;
  episode_tracking_status: string | null;
}

export interface SrvAllocationParseResult {
  rows: SrvAllocationRow[];
  errors: string[];
  rowCount: number;
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s || null;
}

/**
 * Parse the Service Allocation xlsx exported from Epic.
 * Expected columns (case-insensitive): MRN, Patient Name,
 * Nursing Care Stream, PSW Care Stream, Episode Type, Episode Tracking Status.
 */
export function parseSrvAllocationBuffer(buf: ArrayBuffer): SrvAllocationParseResult {
  const errors: string[] = [];
  const rows: SrvAllocationRow[] = [];

  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buf, { type: 'array' });
  } catch {
    return { rows, errors: ['Could not read file — ensure it is a valid .xlsx file.'], rowCount: 0 };
  }

  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) {
    return { rows, errors: ['Workbook appears to be empty.'], rowCount: 0 };
  }

  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null,
    raw: false,
  });

  if (raw.length === 0) {
    return { rows, errors: ['No data rows found in the file.'], rowCount: 0 };
  }

  // Find column keys (case-insensitive)
  const firstRow = raw[0];
  const keyMap = new Map<string, string>();
  for (const key of Object.keys(firstRow)) {
    keyMap.set(key.trim().toLowerCase(), key);
  }

  const col = (name: string) => keyMap.get(name.toLowerCase()) ?? null;

  const mrnKey            = col('mrn');
  const nursingStreamKey  = col('nursing care stream');
  const pswStreamKey      = col('psw care stream');
  const patientNameKey    = col('patient name');
  const episodeTypeKey    = col('episode type');
  const trackingStatusKey = col('episode tracking status');

  if (!mrnKey) {
    errors.push('Could not find MRN column. Ensure the file is the Service Allocation report.');
  }
  if (!nursingStreamKey && !pswStreamKey) {
    errors.push('Could not find Nursing Care Stream or PSW Care Stream columns.');
  }
  if (errors.length) return { rows, errors, rowCount: 0 };

  const seen = new Set<string>();

  for (const rawRow of raw) {
    const mrnRaw = mrnKey ? rawRow[mrnKey] : null;
    const mrn = normalizePatientId(mrnRaw);
    if (!mrn) continue;

    // Deduplicate by MRN — keep first occurrence (most recent episode)
    if (seen.has(mrn)) continue;
    seen.add(mrn);

    rows.push({
      mrn,
      nursing_care_stream: nursingStreamKey  ? str(rawRow[nursingStreamKey])  : null,
      psw_care_stream:     pswStreamKey      ? str(rawRow[pswStreamKey])      : null,
      patient_name:        patientNameKey    ? str(rawRow[patientNameKey])    : null,
      episode_type:        episodeTypeKey    ? str(rawRow[episodeTypeKey])    : null,
      episode_tracking_status: trackingStatusKey ? str(rawRow[trackingStatusKey]) : null,
    });
  }

  return { rows, errors, rowCount: rows.length };
}
