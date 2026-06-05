import * as XLSX from 'xlsx';
import { downloadWorkbook } from '../../export/excelExport';
import { carePlanContentKindLabel } from '../carePlan/classifyCarePlanContent';
import {
  eligibilityReasonLabel,
  getLatestCarePlanRow,
  recordHasTemplatedCarePlan,
} from '../carePlan/linkCarePlans';
import type { CarePlanPatientLink } from '../carePlan/types';

export const CARE_PLAN_CONVERSION_HEADERS = [
  'MRN',
  'GC #',
  'Pathway',
  'IC Lead',
  'Hospital DC Date',
  'Latest Care Plan Date',
  'LVD',
  'Episode Conversion Status',
  'Care Plan Conversion',
] as const;

function formatSsdbDate(value: string | null | undefined): string {
  if (!value?.trim()) return '';
  const d = new Date(`${value.trim()}T12:00:00`);
  if (Number.isNaN(d.getTime())) return value.trim();
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
  });
}

function carePlanCellLabel(link: CarePlanPatientLink): string {
  if (link.carePlanRows.length === 0) return '';
  const kind = recordHasTemplatedCarePlan(link) ? 'templated' : 'unstructured';
  const label = carePlanContentKindLabel(kind);
  const count = link.carePlanRows.length;
  return count === 1 ? label : `${label} (${count})`;
}

const CARE_PLAN_COMPLETED_HEADERS = [
  'MRN',
  'GC #',
  'Pathway',
  'IC Lead',
  'Hospital DC Date',
  'Latest Care Plan Date',
  'LVD',
  'Care Plan Conversion',
] as const;

function formatCarePlanCompletedAt(iso: string | null | undefined): string {
  if (!iso?.trim()) return '';
  const d = new Date(iso.trim());
  if (Number.isNaN(d.getTime())) return iso.trim();
  const month = d.toLocaleDateString('en-US', { month: 'short' });
  const hours = d.getHours().toString().padStart(2, '0');
  const minutes = d.getMinutes().toString().padStart(2, '0');
  return `${month} ${d.getDate()} ${hours}:${minutes}`;
}

function completedByDisplay(email: string | null | undefined): string {
  if (!email?.trim()) return 'unknown';
  return email.split('@')[0];
}

function carePlanConversionStatusLabel(link: CarePlanPatientLink): string {
  if (!link.carePlanCompletedAt) return 'Pending';
  const by = completedByDisplay(link.carePlanCompletedBy);
  const at = formatCarePlanCompletedAt(link.carePlanCompletedAt);
  return `Converted by ${by} on ${at}`;
}

function carePlanConversionCellLabel(
  link: CarePlanPatientLink,
  mode: 'pending' | 'completed'
): string {
  const planPart = carePlanCellLabel(link);
  const statusPart =
    mode === 'pending'
      ? `Care Plan Entered in Epic: ${link.carePlanCompletedAt ? 'Yes' : 'No'}`
      : carePlanConversionStatusLabel(link);
  if (!planPart) return statusPart;
  return `${planPart} — ${statusPart}`;
}

function linkToPendingSheetRow(
  link: CarePlanPatientLink
): Record<(typeof CARE_PLAN_CONVERSION_HEADERS)[number], string> {
  const latestCarePlan = getLatestCarePlanRow(link);
  return {
    MRN: link.mrn,
    'GC #': link.gcn ?? '',
    Pathway: link.pathway ?? '',
    'IC Lead': link.icLead ?? '',
    'Hospital DC Date': formatSsdbDate(link.hospDcDate),
    'Latest Care Plan Date': latestCarePlan?.dateSaved?.trim() ?? '',
    LVD: formatSsdbDate(link.lvd),
    'Episode Conversion Status': link.eligibilityReasons.length
      ? link.eligibilityReasons.map(eligibilityReasonLabel).join(', ')
      : '',
    'Care Plan Conversion': carePlanConversionCellLabel(link, 'pending'),
  };
}

function linkToCompletedSheetRow(
  link: CarePlanPatientLink
): Record<(typeof CARE_PLAN_COMPLETED_HEADERS)[number], string> {
  const latestCarePlan = getLatestCarePlanRow(link);
  return {
    MRN: link.mrn,
    'GC #': link.gcn ?? '',
    Pathway: link.pathway ?? '',
    'IC Lead': link.icLead ?? '',
    'Hospital DC Date': formatSsdbDate(link.hospDcDate),
    'Latest Care Plan Date': latestCarePlan?.dateSaved?.trim() ?? '',
    LVD: formatSsdbDate(link.lvd),
    'Care Plan Conversion': carePlanConversionCellLabel(link, 'completed'),
  };
}

export function downloadCarePlanConversionXlsx(
  links: CarePlanPatientLink[],
  filename: string,
  mode: 'pending' | 'completed' = 'pending'
): void {
  const isPending = mode === 'pending';
  const headers = isPending ? CARE_PLAN_CONVERSION_HEADERS : CARE_PLAN_COMPLETED_HEADERS;
  const sheetRows = links.map((link) =>
    isPending ? linkToPendingSheetRow(link) : linkToCompletedSheetRow(link)
  );
  const ws = sheetRows.length
    ? XLSX.utils.json_to_sheet(sheetRows, { header: [...headers] })
    : XLSX.utils.aoa_to_sheet([['No records to export.']]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    ws,
    isPending ? 'Pending Care Plans' : 'Completed Care Plans'
  );
  downloadWorkbook(wb, filename);
}
