import Papa from 'papaparse';
import type { CsvParseResult } from '../../ingest/parseCsv';
import {
  canonicalizeHomecareHeader,
  isHomecareHeaderRow,
} from './mapHomecareRow';

function trimCells(row: unknown[]): string[] {
  return row.map((c) => String(c ?? '').trim());
}

function findHeaderRowIndex(matrix: unknown[][]): number {
  for (let i = 0; i < matrix.length; i++) {
    if (isHomecareHeaderRow(trimCells(matrix[i]))) return i;
  }
  return -1;
}

/** Parse homecare service CSVs: skip preamble rows, detect header row, ignore extra columns. */
export function parseHomecareCsvBuffer(buf: ArrayBuffer): CsvParseResult {
  const text = new TextDecoder('utf-8').decode(buf);
  const parsed = Papa.parse<unknown[]>(text, {
    header: false,
    skipEmptyLines: true,
  });

  const errors =
    parsed.errors?.map((e) => `${e.row ?? '?'}: ${e.message}`) ?? [];

  const matrix = parsed.data;
  const headerIdx = findHeaderRowIndex(matrix);
  if (headerIdx < 0) {
    return {
      headers: [],
      rows: [],
      errors: [
        ...errors,
        'Could not find header row (expected MRN, Service Date, Service Duration)',
      ],
    };
  }

  const allHeaders = trimCells(matrix[headerIdx]);
  const columns = allHeaders
    .map((header, idx) => ({
      header,
      canonical: canonicalizeHomecareHeader(header),
      idx,
    }))
    .filter((col): col is { header: string; canonical: string; idx: number } =>
      col.canonical != null
    );

  const headers = columns.map((c) => c.canonical);
  const rows: Record<string, unknown>[] = [];

  for (let r = headerIdx + 1; r < matrix.length; r++) {
    const cells = matrix[r] ?? [];
    const row: Record<string, unknown> = {};
    let hasData = false;

    for (const { canonical, idx } of columns) {
      const value = cells[idx];
      if (value !== '' && value != null) hasData = true;
      row[canonical] = value ?? '';
    }

    if (hasData) rows.push(row);
  }

  return { headers, rows, errors };
}
