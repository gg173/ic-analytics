import { normalizeGcnForMatch } from '../carePlan/linkCarePlans';
import { normalizeMrnForMatch } from '../reconciliation/reconcileReportRows';
import type { EpicConversionRecord } from '../types';
import type { EmarInsertRow } from './types';

export interface EmarEnrolmentLink {
  enrolmentRecordId: string;
  enrollId: string | null;
}

export function buildEmarEnrolmentLinkIndex(
  records: readonly Pick<EpicConversionRecord, 'id' | 'enroll_id' | 'mrn' | 'gcn'>[]
): {
  byMrn: Map<string, EmarEnrolmentLink>;
  byGcn: Map<string, EmarEnrolmentLink>;
} {
  const byMrn = new Map<string, EmarEnrolmentLink>();
  const byGcn = new Map<string, EmarEnrolmentLink>();

  for (const record of records) {
    const link: EmarEnrolmentLink = {
      enrolmentRecordId: record.id,
      enrollId: record.enroll_id,
    };

    const mrnKey = normalizeMrnForMatch(record.mrn);
    if (mrnKey && !byMrn.has(mrnKey)) {
      byMrn.set(mrnKey, link);
    }

    if (record.gcn?.trim()) {
      const gcnKey = normalizeGcnForMatch(record.gcn);
      if (!byGcn.has(gcnKey)) {
        byGcn.set(gcnKey, link);
      }
    }
  }

  return { byMrn, byGcn };
}

export function resolveEmarEnrolmentLink(
  row: Pick<EmarInsertRow, 'brn' | 'goldcare_id'>,
  index: ReturnType<typeof buildEmarEnrolmentLinkIndex>
): EmarEnrolmentLink | null {
  const brnKey = normalizeMrnForMatch(row.brn);
  const fromMrn = index.byMrn.get(brnKey);
  if (fromMrn) return fromMrn;

  if (row.goldcare_id?.trim()) {
    const gcnKey = normalizeGcnForMatch(row.goldcare_id);
    return index.byGcn.get(gcnKey) ?? null;
  }

  return null;
}
