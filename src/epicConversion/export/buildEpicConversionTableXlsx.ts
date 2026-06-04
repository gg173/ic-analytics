import * as XLSX from 'xlsx';
import { downloadWorkbook } from '../../export/excelExport';
import type { EpicRecordValidationStatus } from '../reconciliation/reconcileReportRows';
import type { EpicConversionRecord } from '../types';
import { downloadSubmittedDischargesXlsx } from './buildSubmittedDischargesXlsx';

export type EpicTableExportVariant =
  | 'icl-pending'
  | 'icl-decision'
  | 'status-pending'
  | 'status-completion'
  | 'discharge-pending'
  | 'discharge-submitted';

function formatDate(value: string | null | undefined): string {
  if (!value?.trim()) return '';
  const d = new Date(`${value.trim()}T12:00:00`);
  if (Number.isNaN(d.getTime())) return value.trim();
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
  });
}

function formatLosCategoryWithDays(value: string): string {
  const base = value.trim().replace(/\s+days\s*$/i, '');
  return `${base} days`;
}

function formatLosCell(r: EpicConversionRecord): string {
  const parts: string[] = [];
  if (r.los_category?.trim()) {
    parts.push(formatLosCategoryWithDays(r.los_category));
  }
  if (r.los != null) {
    parts.push(`${r.los} days`);
  }
  return parts.join('; ');
}

function formatSrvDetail(r: EpicConversionRecord): string {
  const lvd = formatDate(r.lvd);
  const lvt = r.lvt === 'General Nursing' ? 'Nursing' : r.lvt;
  const noVisit = r.lvt === 'IC Lead Call';
  let text = '';
  if (lvt?.trim()) text += lvt.trim();
  if (lvd) {
    const connector = text ? (noVisit ? ' on ' : ' visit on ') : 'visit on ';
    text += `${connector}${lvd}`;
  }
  if (r.days_since_lvd != null) {
    text += `${text ? ' ' : ''}(${r.days_since_lvd} days ago)`;
  }
  const badge = r.latest_srv?.trim() ?? '';
  if (badge && text) return `${badge} — ${text}`;
  return badge || text;
}

function emailToUsername(email: string | null | undefined): string {
  if (!email?.trim()) return 'unknown';
  return email.split('@')[0];
}

function formatDecisionStampAt(iso: string | null | undefined): string {
  if (!iso?.trim()) return '';
  const d = new Date(iso.trim());
  if (Number.isNaN(d.getTime())) return iso.trim();
  const month = d.toLocaleDateString('en-US', { month: 'short' });
  const hours = d.getHours().toString().padStart(2, '0');
  const minutes = d.getMinutes().toString().padStart(2, '0');
  return `${month} ${d.getDate()} ${hours}:${minutes}`;
}

function iclDecisionLabel(decision: EpicConversionRecord['icl_decision']): string {
  if (decision === 'convert') return 'Convert';
  if (decision === 'discharge') return 'Discharge from Program';
  return 'Pending';
}

function validationStatusText(
  recordId: string,
  validationByRecordId?: Map<string, EpicRecordValidationStatus>
): string {
  const validation = validationByRecordId?.get(recordId);
  if (!validation || validation.status === 'pending') return 'Pending validation';
  if (validation.status === 'discrepancy') {
    return `Discrepancy Detected: ${validation.detail}`;
  }
  return `Validated by ${validation.filename}`;
}

function headersForVariant(variant: EpicTableExportVariant): string[] {
  switch (variant) {
    case 'icl-pending':
      return [
        'MRN',
        'Pathway',
        'Care Path',
        'IC Lead',
        'Hospital DC Date',
        'LOS',
        'Latest Srv',
        'ICL Decision',
      ];
    case 'icl-decision':
      return [
        'MRN',
        'Pathway',
        'Care Path',
        'IC Lead',
        'LOS',
        'LVD',
        'ICL Decision',
        'Decision By',
        'Decision At',
      ];
    case 'status-pending':
      return [
        'MRN',
        'Pathway',
        'Care Path',
        'IC Lead',
        'Hospital DC Date',
        'LOS',
        'Latest Srv',
        'Status',
      ];
    case 'status-completion':
      return [
        'MRN',
        'Pathway',
        'Care Path',
        'IC Lead',
        'LOS',
        'LVD',
        'Completed At',
        'Completed By',
        'Validation Status',
      ];
    case 'discharge-pending':
      return [
        'MRN',
        'Pathway',
        'Care Path',
        'IC Lead',
        'LOS',
        'Latest Srv',
        'Prog DC Date',
        'Prog DC Reason',
      ];
    case 'discharge-submitted':
      return [];
  }
}

function recordToSheetRow(
  record: EpicConversionRecord,
  variant: EpicTableExportVariant,
  validationByRecordId?: Map<string, EpicRecordValidationStatus>
): Record<string, string> {
  switch (variant) {
    case 'icl-pending':
      return {
        MRN: record.mrn,
        Pathway: record.pathway ?? '',
        'Care Path': record.care_path ?? '',
        'IC Lead': record.ic_lead ?? '',
        'Hospital DC Date': formatDate(record.hosp_dc_date ?? record.registration_date),
        LOS: formatLosCell(record),
        'Latest Srv': formatSrvDetail(record),
        'ICL Decision': iclDecisionLabel(record.icl_decision),
      };
    case 'icl-decision':
      return {
        MRN: record.mrn,
        Pathway: record.pathway ?? '',
        'Care Path': record.care_path ?? '',
        'IC Lead': record.ic_lead ?? '',
        LOS: formatLosCell(record),
        LVD: formatDate(record.lvd),
        'ICL Decision': iclDecisionLabel(record.icl_decision),
        'Decision By': emailToUsername(record.icl_decision_by),
        'Decision At': formatDecisionStampAt(record.icl_decision_at),
      };
    case 'status-pending':
      return {
        MRN: record.mrn,
        Pathway: record.pathway ?? '',
        'Care Path': record.care_path ?? '',
        'IC Lead': record.ic_lead ?? '',
        'Hospital DC Date': formatDate(record.hosp_dc_date ?? record.registration_date),
        LOS: formatLosCell(record),
        'Latest Srv': formatSrvDetail(record),
        Status: record.status === 'converted' ? 'Converted' : 'Pending',
      };
    case 'status-completion':
      return {
        MRN: record.mrn,
        Pathway: record.pathway ?? '',
        'Care Path': record.care_path ?? '',
        'IC Lead': record.ic_lead ?? '',
        LOS: formatLosCell(record),
        LVD: formatDate(record.lvd),
        'Completed At': formatDecisionStampAt(record.completed_at),
        'Completed By': emailToUsername(record.completed_by),
        'Validation Status': validationStatusText(record.id, validationByRecordId),
      };
    case 'discharge-pending':
      return {
        MRN: record.mrn,
        Pathway: record.pathway ?? '',
        'Care Path': record.care_path ?? '',
        'IC Lead': record.ic_lead ?? '',
        LOS: formatLosCell(record),
        'Latest Srv': formatSrvDetail(record),
        'Prog DC Date': formatDate(record.discharge_date),
        'Prog DC Reason': record.discharge_reason ?? '',
      };
    case 'discharge-submitted':
      return {};
  }
}

function sheetNameForVariant(variant: EpicTableExportVariant): string {
  switch (variant) {
    case 'icl-pending':
      return 'ICL Decision Required';
    case 'icl-decision':
      return 'ICL Decisions';
    case 'status-pending':
      return 'Pending Conversion';
    case 'status-completion':
      return 'Completed Conversions';
    case 'discharge-pending':
      return 'Pending Discharges';
    case 'discharge-submitted':
      return 'Submitted Discharges';
  }
}

export function downloadEpicConversionTableXlsx(
  records: EpicConversionRecord[],
  variant: EpicTableExportVariant,
  filename: string,
  options?: {
    validationByRecordId?: Map<string, EpicRecordValidationStatus>;
  }
): void {
  if (variant === 'discharge-submitted') {
    downloadSubmittedDischargesXlsx(records, filename);
    return;
  }

  const headers = headersForVariant(variant);
  const sheetRows = records.map((record) =>
    recordToSheetRow(record, variant, options?.validationByRecordId)
  );
  const ws = sheetRows.length
    ? XLSX.utils.json_to_sheet(sheetRows, { header: headers })
    : XLSX.utils.aoa_to_sheet([['No records to export.']]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetNameForVariant(variant));
  downloadWorkbook(wb, filename);
}
