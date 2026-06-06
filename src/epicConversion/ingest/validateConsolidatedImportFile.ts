import { isCarePlanExport } from '../carePlan/parseCarePlanXlsx';
import { isEmarExport } from '../emar/parseEmarXlsx';
import {
  IMPORT_DOCUMENT_TYPE_LABELS,
  type ConsolidatedImportKind,
} from '../components/ConsolidatedImportUploadDialog';
import { parseRawSheet } from './parseEpicConversionXlsx';
import { isEpicReportExport } from './parseEpicConversionReport';
import { isVhaSsdbExport } from './transformVhaSsdbEnrolment';
import { isVhaSsdbServiceExport } from './transformVhaSsdbService';

export function detectConsolidatedImportKind(
  headers: string[]
): ConsolidatedImportKind | null {
  if (isVhaSsdbExport(headers)) return 'enrolment';
  if (isVhaSsdbServiceExport(headers)) return 'serviceData';
  if (isEmarExport(headers)) return 'emar';
  if (isCarePlanExport(headers)) return 'carePlan';
  if (isEpicReportExport(headers)) return 'epicReport';
  return null;
}

export function fileMatchesImportKind(
  headers: string[],
  kind: ConsolidatedImportKind
): boolean {
  switch (kind) {
    case 'enrolment':
      return isVhaSsdbExport(headers);
    case 'serviceData':
      return isVhaSsdbServiceExport(headers);
    case 'carePlan':
      return isCarePlanExport(headers);
    case 'emar':
      return isEmarExport(headers);
    case 'epicReport':
      return isEpicReportExport(headers);
  }
}

export type ConsolidatedImportFileValidationResult =
  | { ok: true }
  | { ok: false; error: string };

export async function validateConsolidatedImportFile(
  file: File,
  expectedKind: ConsolidatedImportKind
): Promise<ConsolidatedImportFileValidationResult> {
  if (!/\.xlsx?$/i.test(file.name)) {
    return { ok: false, error: 'Please choose an Excel file (.xlsx or .xls).' };
  }

  try {
    const buf = await file.arrayBuffer();
    const parsed = parseRawSheet(buf);
    if (parsed.errors.length) {
      return { ok: false, error: parsed.errors[0] };
    }
    if (!parsed.headers.length) {
      return { ok: false, error: 'The spreadsheet has no column headers.' };
    }

    const detectedKind = detectConsolidatedImportKind(parsed.headers);
    if (detectedKind && detectedKind !== expectedKind) {
      return {
        ok: false,
        error: `This file looks like ${IMPORT_DOCUMENT_TYPE_LABELS[detectedKind]}. Use that field instead of ${IMPORT_DOCUMENT_TYPE_LABELS[expectedKind]}.`,
      };
    }

    if (!fileMatchesImportKind(parsed.headers, expectedKind)) {
      return {
        ok: false,
        error: `This file does not match ${IMPORT_DOCUMENT_TYPE_LABELS[expectedKind]}. Check that you exported the correct report.`,
      };
    }

    return { ok: true };
  } catch {
    return {
      ok: false,
      error: 'Could not read the file. Make sure it is a valid Excel workbook.',
    };
  }
}
