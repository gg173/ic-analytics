import * as XLSX from 'xlsx';

export interface SheetParseResult {
  headers: string[];
  rows: Record<string, unknown>[];
  errors: string[];
}

function rowToObject(headers: string[], row: unknown[]): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  headers.forEach((h, i) => {
    if (h) o[h] = row[i];
  });
  return o;
}

export function parseSheetFromBuffer(
  buf: ArrayBuffer,
  sheetName?: string
): SheetParseResult {
  const errors: string[] = [];
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });
  const name =
    sheetName && wb.SheetNames.includes(sheetName)
      ? sheetName
      : wb.SheetNames[0];
  if (!name) {
    return { headers: [], rows: [], errors: ['Workbook has no sheets'] };
  }
  const ws = wb.Sheets[name];
  const data = XLSX.utils.sheet_to_json<(string | number | boolean | Date | null)[]>(
    ws,
    { header: 1, raw: false, defval: null }
  ) as unknown[][];
  if (!data.length) {
    return { headers: [], rows: [], errors: [`Sheet "${name}" is empty`] };
  }
  const rawHeaders = (data[0] as unknown[]).map((c) =>
    c === null || c === undefined ? '' : String(c).trim()
  );
  const headers = rawHeaders;
  const rows: Record<string, unknown>[] = [];
  for (let r = 1; r < data.length; r++) {
    const row = data[r] as unknown[];
    if (!row || !row.some((c) => c !== null && c !== undefined && String(c).trim() !== '')) {
      continue;
    }
    rows.push(rowToObject(headers, row));
  }
  return { headers, rows, errors };
}
