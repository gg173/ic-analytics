import * as XLSX from 'xlsx';
import { pick, str } from './mapEpicConversionRow';
import { mapEpicEpisodeToVhaPathway } from '../reconciliation/epicPathwayMap';

export interface EpicReportParseRow {
  patient_name: string | null;
  mrn: string;
  epic_episode: string | null;
  /** VHA pathway code mapped from Epic episode, when known. */
  pathway: string | null;
  ic_lead: string | null;
  row_index: number;
}

export interface EpicReportParseResult {
  rows: EpicReportParseRow[];
  skipped: number;
  unmappedEpisodes: string[];
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

  const epicEpisode = str(
    pick(row, ['Episode', 'EPISODE', 'episode', 'PATHWAY', 'pathway'])
  );
  const icLead = str(
    pick(row, [
      'ICL/HCS Assigned',
      'ICL / HCS Assigned',
      'ICL HCS Assigned',
      'IC LEAD',
      'IC_LEAD',
      'ic lead',
    ])
  );

  return {
    patient_name: str(pick(row, ['Patient', 'PATIENT', 'patient'])),
    mrn,
    epic_episode: epicEpisode,
    pathway: mapEpicEpisodeToVhaPathway(epicEpisode),
    ic_lead: icLead,
    row_index: rowIndex,
  };
}

export function parseEpicConversionReportBuffer(buf: ArrayBuffer): EpicReportParseResult {
  const parsed = parseRawSheet(buf);
  const errors = [...parsed.errors];

  if (!parsed.rows.length) {
    errors.push('No data rows found in the spreadsheet');
    return { rows: [], skipped: 0, unmappedEpisodes: [], errors };
  }

  const hasMrn = parsed.headers.some((h) => h.trim().toLowerCase().replace(/\s+/g, ' ') === 'mrn');
  if (!hasMrn) {
    errors.push('Missing required column: MRN');
    return { rows: [], skipped: 0, unmappedEpisodes: [], errors };
  }

  const rows: EpicReportParseRow[] = [];
  const unmappedEpisodeSet = new Set<string>();
  let skipped = 0;

  for (let i = 0; i < parsed.rows.length; i += 1) {
    const mapped = mapReportRow(parsed.rows[i], i + 2);
    if (mapped) {
      rows.push(mapped);
      if (mapped.epic_episode && !mapped.pathway) {
        unmappedEpisodeSet.add(mapped.epic_episode);
      }
    } else {
      skipped += 1;
    }
  }

  if (!rows.length) {
    errors.push('No valid rows (each row needs an MRN)');
  }

  const unmappedEpisodes = [...unmappedEpisodeSet].sort((a, b) => a.localeCompare(b));

  return { rows, skipped, unmappedEpisodes, errors };
}
