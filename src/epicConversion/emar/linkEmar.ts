import { normalizeGcnForMatch } from '../carePlan/linkCarePlans';
import type { LinkedEmarRow } from '../carePlan/types';
import { normalizeMrnForMatch } from '../reconciliation/reconcileReportRows';
import type { EpicConversionRecord } from '../types';
import { emarRowFingerprint } from './emarDedup';
import type { EpicEmarRow } from './types';

export function mapEmarRowToLinked(
  row: EpicEmarRow,
  sourceFilenameByImportId: Map<string, string>
): LinkedEmarRow {
  return {
    id: row.id,
    importId: row.import_id,
    sourceFilename: sourceFilenameByImportId.get(row.import_id) ?? '—',
    brn: row.brn,
    clientId: row.client_id,
    offerId: row.offer_id,
    goldcareId: row.goldcare_id,
    medicationName: row.medication_name,
    lastAdminAt: row.last_admin_at,
    dose: row.dose,
    route: row.route,
    frequency: row.frequency,
    totalNumberOfDoses: row.total_number_of_doses,
    orderOrDispensedDate: row.order_or_dispensed_date,
    endDate: row.end_date,
    rowIndex: row.row_index,
  };
}

function indexEmarRows(
  emarRows: EpicEmarRow[],
  sourceFilenameByImportId: Map<string, string>
): {
  byRecordId: Map<string, LinkedEmarRow[]>;
  byBrn: Map<string, LinkedEmarRow[]>;
  byGcn: Map<string, LinkedEmarRow[]>;
} {
  const byRecordId = new Map<string, LinkedEmarRow[]>();
  const byBrn = new Map<string, LinkedEmarRow[]>();
  const byGcn = new Map<string, LinkedEmarRow[]>();

  for (const row of emarRows) {
    const linked = mapEmarRowToLinked(row, sourceFilenameByImportId);

    if (row.enrolment_record_id) {
      const list = byRecordId.get(row.enrolment_record_id) ?? [];
      list.push(linked);
      byRecordId.set(row.enrolment_record_id, list);
    }

    const brnKey = normalizeMrnForMatch(row.brn);
    if (brnKey) {
      const list = byBrn.get(brnKey) ?? [];
      list.push(linked);
      byBrn.set(brnKey, list);
    }

    if (row.goldcare_id?.trim()) {
      const gcnKey = normalizeGcnForMatch(row.goldcare_id);
      const list = byGcn.get(gcnKey) ?? [];
      list.push(linked);
      byGcn.set(gcnKey, list);
    }
  }

  return { byRecordId, byBrn, byGcn };
}

function linkedEmarFingerprint(row: LinkedEmarRow): string {
  return emarRowFingerprint({
    brn: row.brn,
    client_id: row.clientId,
    offer_id: row.offerId,
    goldcare_id: row.goldcareId,
    medication_name: row.medicationName,
    last_admin_at: row.lastAdminAt,
    dose: row.dose,
    route: row.route,
    frequency: row.frequency,
    total_number_of_doses: row.totalNumberOfDoses,
    order_or_dispensed_date: row.orderOrDispensedDate,
    end_date: row.endDate,
  });
}

function dedupeLinkedEmarRows(rows: LinkedEmarRow[]): LinkedEmarRow[] {
  const bestByFingerprint = new Map<string, LinkedEmarRow>();
  for (const row of rows) {
    const fingerprint = linkedEmarFingerprint(row);
    const existing = bestByFingerprint.get(fingerprint);
    if (!existing || row.rowIndex >= existing.rowIndex) {
      bestByFingerprint.set(fingerprint, row);
    }
  }
  return [...bestByFingerprint.values()];
}

export function matchEmarRowsForRecord(
  record: EpicConversionRecord,
  byRecordId: Map<string, LinkedEmarRow[]>,
  byBrn: Map<string, LinkedEmarRow[]>,
  byGcn: Map<string, LinkedEmarRow[]>
): LinkedEmarRow[] {
  const matched = new Map<string, LinkedEmarRow>();

  for (const row of byRecordId.get(record.id) ?? []) {
    matched.set(row.id, row);
  }

  const mrnKey = normalizeMrnForMatch(record.mrn);
  for (const row of byBrn.get(mrnKey) ?? []) {
    matched.set(row.id, row);
  }

  if (record.gcn?.trim()) {
    const gcnKey = normalizeGcnForMatch(record.gcn);
    for (const row of byGcn.get(gcnKey) ?? []) {
      matched.set(row.id, row);
    }
  }

  const deduped = dedupeLinkedEmarRows([...matched.values()]);
  return deduped.sort((a, b) => {
    const fileCmp = a.sourceFilename.localeCompare(b.sourceFilename);
    if (fileCmp !== 0) return fileCmp;
    return a.rowIndex - b.rowIndex;
  });
}

export function buildEmarRowIndex(
  emarRows: EpicEmarRow[],
  sourceFilenameByImportId: Map<string, string>
) {
  return indexEmarRows(emarRows, sourceFilenameByImportId);
}
