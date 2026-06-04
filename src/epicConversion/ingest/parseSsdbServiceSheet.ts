import * as XLSX from 'xlsx';

function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function rowHasAppliedFilters(row: unknown[]): boolean {
  return row.some((cell) => cellText(cell).startsWith('Applied filters'));
}

/**
 * Parse VHA SSDB Service export: skip "#" column, stop at "Applied filters:" row.
 */
export function parseSsdbServiceSheet(buf: ArrayBuffer): {
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

  const rawHeaders = (data[0] as unknown[]).map((c) => cellText(c));
  const headers = rawHeaders.filter((h) => h !== '' && h !== '#');
  const columnIndexes = rawHeaders
    .map((h, index) => ({ h, index }))
    .filter(({ h }) => h !== '' && h !== '#')
    .map(({ index }) => index);

  if (!headers.length) {
    return { headers: [], rows: [], errors: ['Header row is empty'] };
  }

  const rows: Record<string, unknown>[] = [];
  for (let r = 1; r < data.length; r++) {
    const row = data[r] as unknown[];
    if (!row || rowHasAppliedFilters(row)) break;
    if (!row.some((c) => cellText(c) !== '')) continue;

    const obj: Record<string, unknown> = {};
    headers.forEach((header, i) => {
      obj[header] = row[columnIndexes[i]];
    });
    rows.push(obj);
  }

  return { headers, rows, errors };
}
