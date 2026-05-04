import Papa from 'papaparse';

export interface CsvParseResult {
  headers: string[];
  rows: Record<string, unknown>[];
  errors: string[];
}

export function parseCsvBuffer(buf: ArrayBuffer): CsvParseResult {
  const text = new TextDecoder('utf-8').decode(buf);
  const parsed = Papa.parse<Record<string, unknown>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });
  const errors =
    parsed.errors?.map((e) => `${e.row ?? '?'}: ${e.message}`) ?? [];
  const rows = parsed.data.filter(
    (r) => r && Object.values(r).some((v) => v !== '' && v != null)
  );
  const headers = parsed.meta.fields ?? [];
  return { headers, rows, errors };
}
