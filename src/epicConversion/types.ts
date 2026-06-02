export type EpicConversionStatus = 'converted' | 'discharged';

export type IclDecision = 'pending' | 'convert' | 'discharge';
export type IclDecisionValue = 'convert' | 'discharge';

export type DischargeDateSource = 'lvd' | 'pdd' | 'other';

export const DISCHARGE_REASONS = [
  'Self Care/Independence/Service Plan Complete',
  'OHaH Services',
  'Rehabilitation',
  'Death',
  'Admitted to LTC',
  'Hospitalization',
  'Client Preference',
  'Other Community Services',
  'Other',
] as const;

export type DischargeReason = (typeof DISCHARGE_REASONS)[number];

export interface EpicConversionRecord {
  id: string;
  enroll_id: string | null;
  gcn: string | null;
  mrn: string;
  pathway: string | null;
  care_path: string | null;
  support_tier: string | null;
  ic_lead: string | null;
  registration_date: string | null;
  hosp_dc_date: string | null;
  episode_conversion_strategy: string | null;
  los: string | null;
  los_category: string | null;
  latest_srv: string | null;
  days_since_lvd: number | null;
  lvd: string | null;
  lvt: string | null;
  status: EpicConversionStatus | null;
  icl_decision: IclDecisionValue | null;
  icl_decision_by: string | null;
  icl_decision_at: string | null;
  completed_by: string | null;
  completed_at: string | null;
  care_plan_completed_by: string | null;
  care_plan_completed_at: string | null;
  discharge_date_source: DischargeDateSource | null;
  discharge_date: string | null;
  discharge_reason: string | null;
  discharged_by: string | null;
  discharged_at: string | null;
  source_filename: string;
  imported_at: string;
  imported_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface EpicConversionInsertRow {
  enroll_id?: string | null;
  gcn: string | null;
  mrn: string;
  pathway: string | null;
  care_path: string | null;
  support_tier: string | null;
  ic_lead: string | null;
  registration_date: string | null;
  hosp_dc_date: string | null;
  episode_conversion_strategy: string | null;
  los: string | null;
  los_category: string | null;
  latest_srv: string | null;
  days_since_lvd: number | null;
  lvd: string | null;
  lvt: string | null;
  source_filename: string;
}

export const EPIC_CONVERSION_HEADERS = [
  'ENROLL ID',
  'GCN',
  'MRN',
  'PATHWAY',
  'CARE PATH',
  'SUPPORT TIER',
  'IC LEAD',
  'REGISTRATION DATE',
  'HOSP DC DATE',
  'EPISODE_CONVERSION_STRATEGY',
  'LOS',
  'LOS_CATEGORY',
  'LATEST_SRV',
  'DAYS_SINCE_LVD',
  'LVD',
  'LVT',
] as const;
