export interface MergedClinicalRow {
  patientKey: string;
  carePath: string;
  hospDcDate: Date | null;
  monthBucket: Date | null;
  contactIn24h: boolean | null;
  weekendDc: boolean | null;
  supportLineCalls: number;
  scheduledCheckInCalls: number;
  enrollStatus: string;
  hospitalSite: string | null;
  flowsheetMatchDaysDelta: number | null;
}

export interface SurveyRowIp {
  patientKey: string | null;
  visitId: string | null;
  createdOn: Date | null;
  raw: Record<string, unknown>;
}

export interface SurveyRowIc {
  patientKey: string | null;
  visitId: string | null;
  createdOn: Date | null;
  raw: Record<string, unknown>;
}

export type ClinicalSiteGroup = 'TG' | 'TW' | 'TG+TW' | 'Other';

export interface PathwayMetricSlice {
  pathwayId: string;
  /** CARE PATH value from the VHA extract */
  carePath: string;
  site: ClinicalSiteGroup;
  volume: number;
  contact24Numerator: number;
  contact24Pct: number | null;
  weekendNumerator: number;
  weekendPct: number | null;
  avgSupportLinePerPt: number | null;
  avgCheckInPerPt: number | null;
}

export interface MonthlyClinicalRollup {
  monthKey: string;
  monthLabel: string;
  monthStart: Date;
  byPathway: PathwayMetricSlice[];
}

export interface LinkageStats {
  vhaRowCount: number;
  flowsheetRowCount: number;
  /** VHA rows with Flowsheet MRN + same-day hospital DC match (enrolment volume cohort). */
  vhaMrnHospDcMatched: number;
  /** Count displayed in Venn overlap. */
  linkedCount: number;
  /** Count displayed in Venn left-only segment. */
  vhaOnlyCount: number;
  /** Count displayed in Venn right-only segment. */
  flowsheetOnlyCount: number;
  mergedWithSite: number;
  mergedWithoutSite: number;
  peIpRows: number;
  peIcRows: number;
  peIpWithClinical: number;
  peIcWithClinical: number;
}

export interface SurveyIpSummary {
  n: number;
  nRecommend: number;
  nps: number | null;
  pctOverallGte8: number | null;
  testimonialSamples: string[];
}

export interface SurveyIcSummary {
  n: number;
  pctRatingGte4: number | null;
  testimonialSamples: string[];
}

/** Rows not achieving same‑calendar linkage vs counterpart dataset (for QA exports). */
export interface LinkageMismatchLists {
  vhaOnlyRows: Record<string, unknown>[];
  flowsheetOnlyRows: Record<string, unknown>[];
}

export interface AnalyticsBundle {
  merged: MergedClinicalRow[];
  linkage: LinkageStats;
  /** Rows without same-day Flowsheet ↔ VHA match vs filtered Flowsheet cohort. */
  linkageMismatchLists: LinkageMismatchLists;
  clinicalRollups: MonthlyClinicalRollup[];
  surveyIp: SurveyIpSummary | null;
  surveyIc: SurveyIcSummary | null;
  errors: string[];
  warnings: string[];
}
