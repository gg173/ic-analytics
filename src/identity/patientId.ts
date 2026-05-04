/** 7-digit zero-padded MRN for cross-file joins. */

export function normalizePatientId(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const digits = s.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length > 7) return digits.slice(-7);
  return digits.padStart(7, '0');
}

/** Survey VisitID: avoid float corruption from scientific notation in CSV. */
export function normalizeVisitId(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return String(Math.round(raw));
  }
  const s = String(raw).trim();
  if (!s) return null;
  if (/^[\d.]+[eE][+-]?\d+$/.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n)) return String(Math.round(n));
  }
  return s;
}
