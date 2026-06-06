export const MAX_IMPORT_ROWS = 100_000;

export function validateImportRowCount(rowCount: number): string | null {
  if (rowCount > MAX_IMPORT_ROWS) {
    return `File has ${rowCount.toLocaleString()} rows; maximum allowed is ${MAX_IMPORT_ROWS.toLocaleString()}`;
  }
  return null;
}

export function normalizedHeaderSet(headers: string[]): Set<string> {
  return new Set(
    headers
      .map((h) => h.trim().toLowerCase().replace(/\s+/g, ' '))
      .filter(Boolean)
  );
}

export function hasHeaderAlias(
  normalized: Set<string>,
  aliases: readonly string[]
): boolean {
  return aliases.some((alias) =>
    normalized.has(alias.trim().toLowerCase().replace(/\s+/g, ' '))
  );
}

export function missingHeaderErrors(
  headers: string[],
  expected: ReadonlyArray<{ label: string; aliases: readonly string[] }>
): string[] {
  const normalized = normalizedHeaderSet(headers);
  const errors: string[] = [];
  for (const { label, aliases } of expected) {
    if (!hasHeaderAlias(normalized, aliases)) {
      errors.push(`Missing required column: ${label}`);
    }
  }
  return errors;
}
