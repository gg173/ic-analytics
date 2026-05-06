import type {
  AnalyticsBundle,
  LinkageMismatchLists,
  LinkageStats,
} from '../data/types';
import {
  mergeVhaFlowsheet,
  indexFlowsheet,
  filterFlowsheetRows,
  partitionLinkageMismatchLists,
} from './merge';
import { buildClinicalRollups } from './clinicalKpis';
import {
  summarizeIpSurvey,
  summarizeIcSurvey,
  countSurveyLinkage,
} from './surveys';

export interface ParsedInputs {
  vha?: { rows: Record<string, unknown>[]; sheet: string };
  flowsheet?: { rows: Record<string, unknown>[] };
  peIp?: { rows: Record<string, unknown>[]; headers: string[] };
  peIc?: { rows: Record<string, unknown>[]; headers: string[] };
}

export function buildAnalytics(inputs: ParsedInputs): AnalyticsBundle {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!inputs.vha?.rows.length) {
    errors.push('VHA extract is required (Excel, Export sheet).');
  }
  if (!inputs.flowsheet?.rows.length) {
    warnings.push(
      'Flowsheet extract missing — Hospital Site and enrolment volumes (MRN + same hospital DC date) require the Flowsheet upload.'
    );
  }

  if (errors.length) {
    return {
      merged: [],
      linkage: emptyLinkage(),
      linkageMismatchLists: emptyLinkageMismatch(),
      clinicalRollups: [],
      surveyIp: null,
      surveyIc: null,
      errors,
      warnings,
    };
  }

  const rawFlowsheetRows = inputs.flowsheet?.rows ?? [];
  const flowsheetRows = rawFlowsheetRows.length
    ? filterFlowsheetRows(rawFlowsheetRows)
    : [];

  const fsIdx = flowsheetRows.length
    ? indexFlowsheet(flowsheetRows)
    : { byPatient: new Map<string, Record<string, unknown>[]>() };

  const merged = mergeVhaFlowsheet(inputs.vha!.rows, fsIdx.byPatient);
  const linkageMismatchLists = partitionLinkageMismatchLists(
    inputs.vha!.rows,
    flowsheetRows,
    fsIdx.byPatient
  );
  const clinicalKeys = new Set(merged.map((m) => m.patientKey));

  let mergedWithSite = 0;
  let mergedWithoutSite = 0;
  let vhaMrnHospDcMatched = 0;
  for (const m of merged) {
    if (m.hospitalSite) mergedWithSite += 1;
    else mergedWithoutSite += 1;
    if (m.flowsheetMatchDaysDelta === 0) vhaMrnHospDcMatched += 1;
  }
  const linkedCount = vhaMrnHospDcMatched;
  const vhaOnlyCount = Math.max(inputs.vha!.rows.length - linkedCount, 0);
  const flowsheetOnlyCount = Math.max(flowsheetRows.length - linkedCount, 0);

  const ipHeaders = inputs.peIp?.headers ?? [];
  const icHeaders = inputs.peIc?.headers ?? [];
  const ipPk = ipHeaders.find((h) => /^PatientID$/i.test(h));
  const icPk = icHeaders.find((h) => /Patient_ID/i.test(h));

  const linkage: LinkageStats = {
    vhaRowCount: inputs.vha!.rows.length,
    flowsheetRowCount: flowsheetRows.length,
    vhaMrnHospDcMatched,
    linkedCount,
    vhaOnlyCount,
    flowsheetOnlyCount,
    mergedWithSite,
    mergedWithoutSite,
    peIpRows: inputs.peIp?.rows.length ?? 0,
    peIcRows: inputs.peIc?.rows.length ?? 0,
    peIpWithClinical: inputs.peIp?.rows.length
      ? countSurveyLinkage(inputs.peIp.rows, ipPk, clinicalKeys)
      : 0,
    peIcWithClinical: inputs.peIc?.rows.length
      ? countSurveyLinkage(inputs.peIc.rows, icPk, clinicalKeys)
      : 0,
  };

  const clinicalRollups = buildClinicalRollups(merged);

  const surveyIp = inputs.peIp?.rows.length
    ? summarizeIpSurvey(inputs.peIp.rows, ipHeaders, clinicalKeys)
    : null;

  const surveyIc = inputs.peIc?.rows.length
    ? summarizeIcSurvey(inputs.peIc.rows, icHeaders, clinicalKeys)
    : null;

  if (!inputs.peIp?.rows.length) warnings.push('Inpatient survey CSV not loaded.');
  if (!inputs.peIc?.rows.length) warnings.push('IC survey CSV not loaded.');

  return {
    merged,
    linkage,
    linkageMismatchLists,
    clinicalRollups,
    surveyIp,
    surveyIc,
    errors,
    warnings,
  };
}

function emptyLinkage(): LinkageStats {
  return {
    vhaRowCount: 0,
    flowsheetRowCount: 0,
    vhaMrnHospDcMatched: 0,
    linkedCount: 0,
    vhaOnlyCount: 0,
    flowsheetOnlyCount: 0,
    mergedWithSite: 0,
    mergedWithoutSite: 0,
    peIpRows: 0,
    peIcRows: 0,
    peIpWithClinical: 0,
    peIcWithClinical: 0,
  };
}

function emptyLinkageMismatch(): LinkageMismatchLists {
  return { vhaOnlyRows: [], flowsheetOnlyRows: [] };
}
