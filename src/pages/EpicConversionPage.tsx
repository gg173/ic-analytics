import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useEpicConversionMapsContextOptional } from '../epicConversion/context/EpicConversionMapsProvider';
import { parseEpicConversionXlsxBuffer } from '../epicConversion/ingest/parseEpicConversionXlsx';
import { useEpicConversionRecords } from '../epicConversion/hooks/useEpicConversionRecords';
import { useEpicConversionReports } from '../epicConversion/hooks/useEpicConversionReports';
import { useEpicCarePlanImports } from '../epicConversion/hooks/useEpicCarePlanImports';
import { useEpicEmarImports } from '../epicConversion/hooks/useEpicEmarImports';
import { useEpicSsdbServiceImports } from '../epicConversion/hooks/useEpicSsdbServiceImports';
import { ConversionDiscrepanciesPanel } from '../epicConversion/components/ConversionDiscrepanciesPanel';
import {
  buildCarePlanPatientLinks,
  computeCarePlanProgressMetrics,
  DEFAULT_SSDB_VISIT_TO_DATE,
  findCompletedRecordIdsNeedingCarePlanRecheck,
  type CarePlanDateRange,
} from '../epicConversion/carePlan/linkCarePlans';
import {
  CarePlanConversionPanel,
  useCarePlanConversionData,
  useCarePlanDefaultTabPendingCount,
} from '../epicConversion/components/CarePlanConversionPanel';
import {
  ConsolidatedImportUploadDialog,
  IMPORT_DOCUMENT_TYPE_LABELS,
  type ConsolidatedImportFiles,
  type ConsolidatedImportKind,
} from '../epicConversion/components/ConsolidatedImportUploadDialog';
import type { ImportUploadDialogPhase } from '../epicConversion/components/EnrolmentUploadDialog';
import { SsdbEnrolmentHowtoModal } from '../epicConversion/components/SsdbEnrolmentHowtoModal';
import { ProgressTracker } from '../epicConversion/components/ProgressTracker';
import { ServiceDataCalendar } from '../epicConversion/components/ServiceDataCalendar';
import {
  computeServiceDayPatientsByDate,
  computeServiceDayServices,
  computeTemplatedCarePlanCountByServiceDay,
  computeTemplatedCarePlanCountByServiceWeek,
  computeTemplatedCarePlanPercentByServiceDay,
  computeTemplatedCarePlanPercentByServiceWeek,
  indexPatientSsdbServiceDetails,
} from '../epicConversion/serviceData/linkServiceDayCarePlans';
import {
  aggregateSsdbServiceDayRows,
  buildRecordByEnrollId,
  hasActiveServiceDayPatientFilter,
  ssdbServiceRowMatchesPatientFilter,
} from '../epicConversion/serviceData/filterServiceDayPatient';
import { DownloadDataIcon } from '../epicConversion/components/DownloadDataIcon';
import { TableExportButton } from '../epicConversion/components/TableExportButton';
import {
  buildEpicSnapshotByMatchedRecordId,
  buildEpicValidationStatusByRecordId,
  getLatestEpicImportedAt,
  isConversionPendingEpicAdjudication,
  isValidatedOutcome,
  matchesReconciliationOutcomeFilter,
} from '../epicConversion/reconciliation/reconcileReportRows';
import type { ReconciliationOutcomeFilter } from '../epicConversion/reconciliation/types';
import { computeImportActivity } from '../epicConversion/progress/computeImportActivity';
import { formatStrategyBreakdown } from '../epicConversion/progress/computeImportActivity';
import { buildUnifiedImportActivity } from '../epicConversion/progress/computeUnifiedImportActivity';
import { computeDailyProgressSeries } from '../epicConversion/progress/computeDailyProgressSeries';
import { computeProgressMetrics, GO_LIVE_DATE } from '../epicConversion/progress/computeProgressMetrics';
import {
  DISCHARGE_STRATEGY,
  EPISODE_CONVERSION_STRATEGY,
  ICL_REASSESSMENT_STRATEGY,
  NO_STRATEGY_LABEL,
  recordBelongsToStrategyTab,
  recordBelongsToStrategyTabBadge,
  recordNeedsIclReassessment,
  sortStrategyTabs,
  strategyTabLabel,
} from '../epicConversion/progress/recordStrategyTabs';
import type {
  DischargeDateSource,
  DischargeReason,
  EpicConversionRecord,
  IclDecision,
  IclDecisionValue,
} from '../epicConversion/types';
import { DISCHARGE_REASONS } from '../epicConversion/types';
import { ToolbarMultiSelect, matchesMultiFilter } from '../epicConversion/components/ToolbarMultiSelect';
import { downloadEnrolmentImportXlsx } from '../epicConversion/export/buildEnrolmentXlsx';
import { downloadSsdbServiceImportXlsx } from '../epicConversion/export/buildSsdbServiceImportXlsx';
import { downloadCarePlanImportXlsx } from '../epicConversion/export/buildCarePlanImportXlsx';
import { downloadEmarImportXlsx } from '../epicConversion/export/buildEmarImportXlsx';
import { downloadEpicReportImportXlsx } from '../epicConversion/export/buildEpicReportXlsx';
import {
  downloadEpicConversionTableXlsx,
  type EpicTableExportVariant,
} from '../epicConversion/export/buildEpicConversionTableXlsx';
import { useAuth } from '../homecare/hooks/useAuth';
import { uploaderLabel } from '../homecare/hooks/useBatch';
import type { BatchUploader } from '../homecare/types';
import { supabase } from '../lib/supabase';

function highlightMatch(text: string | null | undefined, query: string): ReactNode {
  const value = text ?? '—';
  const q = query.trim();
  if (!q || value === '—') return value;

  const lowerValue = value.toLowerCase();
  const lowerQuery = q.toLowerCase();
  if (!lowerValue.includes(lowerQuery)) return value;

  const parts: ReactNode[] = [];
  let start = 0;
  let index = lowerValue.indexOf(lowerQuery, start);

  while (index !== -1) {
    if (index > start) parts.push(value.slice(start, index));
    parts.push(
      <mark key={index} className="hc-search-highlight">
        {value.slice(index, index + q.length)}
      </mark>
    );
    start = index + q.length;
    index = lowerValue.indexOf(lowerQuery, start);
  }

  if (start < value.length) parts.push(value.slice(start));
  return parts;
}

function addDaysToIsoDate(isoDate: string, days: number): string | null {
  const d = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function computePddDate(r: EpicConversionRecord): string | null {
  const base = r.hosp_dc_date ?? r.registration_date;
  if (!base) return null;
  const days = r.pathway === 'UHN-TRANSITION' ? 120 : 90;
  return addDaysToIsoDate(base, days);
}

function resolveDischargeDate(
  r: EpicConversionRecord,
  source: DischargeDateSource,
  customDate: string | null
): string | null {
  switch (source) {
    case 'lvd':
      return r.lvd;
    case 'pdd':
      return computePddDate(r);
    case 'other':
      return customDate;
  }
}

function isDischargeSubmitReady(
  record: EpicConversionRecord,
  pddDate: string | null
): boolean {
  const reason = record.discharge_reason?.trim();
  if (!reason || !DISCHARGE_REASONS.includes(reason as DischargeReason)) {
    return false;
  }

  const source = record.discharge_date_source;
  if (!source || !record.discharge_date) return false;

  switch (source) {
    case 'lvd':
      return !!record.lvd;
    case 'pdd':
      return !!pddDate;
    case 'other':
      return true;
  }
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value + 'T12:00:00');
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
  });
}

function formatSrvDetail(r: EpicConversionRecord): string {
  const lvd = formatDate(r.lvd);
  const lvt = r.lvt === 'General Nursing' ? 'Nursing' : r.lvt;
  const noVisit = r.lvt === 'IC Lead Call';
  let text = '';
  if (lvt) text += lvt;
  if (lvd !== '—') {
    const connector = text ? (noVisit ? ' on ' : ' visit on ') : 'visit on ';
    text += `${connector}${lvd}`;
  }
  if (r.days_since_lvd != null) text += `${text ? ' ' : ''}(${r.days_since_lvd} days ago)`;
  return text || '—';
}

function strategyTabCountClassName(strategy: string): string {
  const base = 'hc-strategy-tab-count';
  switch (strategy) {
    case EPISODE_CONVERSION_STRATEGY:
      return `${base} ${base}--episode`;
    case ICL_REASSESSMENT_STRATEGY:
      return `${base} ${base}--icl`;
    case DISCHARGE_STRATEGY:
      return `${base} ${base}--discharge`;
    default:
      return base;
  }
}

function formatImportUploadedDateParts(
  importedAt: string
): { date: string; time: string } | null {
  const d = new Date(importedAt);
  if (Number.isNaN(d.getTime())) {
    return null;
  }
  const weekday = d.toLocaleDateString('en-US', { weekday: 'short' });
  const month = d.toLocaleDateString('en-US', { month: 'short' });
  const day = d.getDate().toString().padStart(2, '0');
  const year = d.getFullYear();
  const time = d
    .toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    })
    .toLowerCase();
  return { date: `${weekday} ${month} ${day}, ${year}`, time };
}

function ImportUploadedDateCell({ importedAt }: { importedAt: string }) {
  const parts = formatImportUploadedDateParts(importedAt);
  if (!parts) {
    return <>{importedAt}</>;
  }
  return (
    <div className="hc-import-uploaded-date">
      <span className="hc-import-uploaded-date-day">{parts.date}</span>
      <span className="hc-import-uploaded-date-time">{parts.time}</span>
    </div>
  );
}

function formatCompletedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function formatDecisionStampAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const month = d.toLocaleDateString('en-US', { month: 'short' });
  const hours = d.getHours().toString().padStart(2, '0');
  const minutes = d.getMinutes().toString().padStart(2, '0');
  return `${month} ${d.getDate()} ${hours}:${minutes}`;
}

// The username shown beneath the checkbox is the part of the email before "@".
function emailToUsername(email: string | null | undefined): string {
  if (!email) return 'unknown';
  return email.split('@')[0];
}

function formatEpicValidationStatus(
  recordId: string,
  validationByRecordId: ReturnType<typeof buildEpicValidationStatusByRecordId>
): { text: string; className: string } {
  const validation = validationByRecordId.get(recordId);
  if (!validation || validation.status === 'pending') {
    return {
      text: 'Pending validation',
      className: 'hc-epic-compact-validation--pending',
    };
  }
  if (validation.status === 'discrepancy') {
    return {
      text: `Discrepancy Detected: ${validation.detail}`,
      className: 'hc-epic-compact-validation--discrepancy',
    };
  }
  return {
    text: `Validated by ${validation.filename}`,
    className: 'hc-epic-compact-validation--validated',
  };
}

function countEpicValidationStatuses(
  records: EpicConversionRecord[],
  validationByRecordId: ReturnType<typeof buildEpicValidationStatusByRecordId>
): { pending: number; discrepancy: number; validated: number } {
  let pending = 0;
  let discrepancy = 0;
  let validated = 0;
  for (const record of records) {
    const status = validationByRecordId.get(record.id);
    if (status?.status === 'validated') validated += 1;
    else if (status?.status === 'discrepancy') discrepancy += 1;
    else pending += 1;
  }
  return { pending, discrepancy, validated };
}

type CompletionValidationFilter = 'all' | 'pending' | 'discrepancy' | 'validated';

function getRecordValidationKind(
  recordId: string,
  validationByRecordId: ReturnType<typeof buildEpicValidationStatusByRecordId>
): Exclude<CompletionValidationFilter, 'all'> {
  const status = validationByRecordId.get(recordId);
  if (status?.status === 'validated') return 'validated';
  if (status?.status === 'discrepancy') return 'discrepancy';
  return 'pending';
}

function isOver90LosCategory(value: string): boolean {
  return /^>\s*90\b/i.test(value.trim().replace(/\s+days\s*$/i, ''));
}

/** Strip a trailing "days" from stored values; UI appends " days" when rendering. */
function formatLosCategoryWithDays(value: string): string {
  const base = value.trim().replace(/\s+days\s*$/i, '');
  return `${base} days`;
}

function UploadDataIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" aria-hidden>
      <path d="M0 0h24v24H0z" fill="none" />
      <path
        fill="currentColor"
        d="M11 16V7.85l-2.6 2.6L7 9l5-5l5 5l-1.4 1.45l-2.6-2.6V16zm-5 4q-.825 0-1.412-.587T4 18v-3h2v3h12v-3h2v3q0 .825-.587 1.413T18 20z"
      />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" aria-hidden>
      <path d="M0 0h24v24H0z" fill="none" />
      <path
        fill="currentColor"
        d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"
      />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1.15em" height="1.15em" viewBox="0 0 24 24" aria-hidden>
      <path d="M0 0h24v24H0z" fill="none" />
      <path
        fill="currentColor"
        d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"
      />
    </svg>
  );
}

function sortLosCategoryOptions(options: string[]): string[] {
  return [...options].sort((a, b) => {
    const aOver = isOver90LosCategory(a);
    const bOver = isOver90LosCategory(b);
    if (aOver && !bOver) return 1;
    if (!aOver && bOver) return -1;
    return a.localeCompare(b);
  });
}

function latestSrvSortKey(value: string): number {
  const trimmed = value.trim();
  if (/^future service scheduled$/i.test(trimmed)) return -1;
  const overMatch = /^>\s*(\d+)/i.exec(trimmed);
  if (overMatch) return Number(overMatch[1]) + 10000;
  const rangeMatch = /^(\d+)/.exec(trimmed);
  if (rangeMatch) return Number(rangeMatch[1]);
  return Number.MAX_SAFE_INTEGER;
}

function sortLatestSrvOptions(options: string[]): string[] {
  return [...options].sort((a, b) => {
    const ak = latestSrvSortKey(a);
    const bk = latestSrvSortKey(b);
    if (ak !== bk) return ak - bk;
    return a.localeCompare(b);
  });
}

function distinctOptions(
  records: EpicConversionRecord[],
  selector: (r: EpicConversionRecord) => string | null
): string[] {
  const set = new Set<string>();
  for (const r of records) {
    const v = selector(r);
    if (v) set.add(v);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

const PROGRESS_TRACKER_TAB = 'Progress Tracker';
const EPISODE_VALIDATION_TAB = 'Episode Validation';
const CARE_PLAN_CONVERSION_TAB = 'Care Plan Conversion';
const SERVICE_DATA_CONVERSION_TAB = 'Service Data Conversion';
const UPLOAD_DATA_TAB = 'Import Data';

function formatPathwayWithCarePath(r: EpicConversionRecord): string {
  if (r.pathway && r.care_path) return `${r.pathway} (${r.care_path})`;
  return r.pathway ?? r.care_path ?? '—';
}

type EpicTableSortKey = 'pathway' | 'ic_lead' | 'hosp_dc' | 'los' | 'latest_srv';
type ImportTableSortKey = 'documentType' | 'importedAt' | 'uploadedBy';
type SortDirection = 'asc' | 'desc';

function compareConsolidatedImportRows(
  a: {
    documentType: string;
    importedAt: string;
    uploadedByLabel: string;
  },
  b: {
    documentType: string;
    importedAt: string;
    uploadedByLabel: string;
  },
  key: ImportTableSortKey,
  direction: SortDirection
): number {
  let cmp = 0;
  switch (key) {
    case 'documentType':
      cmp = a.documentType.localeCompare(b.documentType, undefined, { sensitivity: 'base' });
      break;
    case 'importedAt':
      cmp = new Date(a.importedAt).getTime() - new Date(b.importedAt).getTime();
      break;
    case 'uploadedBy':
      cmp = a.uploadedByLabel.localeCompare(b.uploadedByLabel, undefined, {
        sensitivity: 'base',
      });
      break;
  }
  return direction === 'asc' ? cmp : -cmp;
}

function compareSortStrings(
  a: string | null | undefined,
  b: string | null | undefined,
  direction: SortDirection
): number {
  const av = (a ?? '').trim().toLowerCase();
  const bv = (b ?? '').trim().toLowerCase();
  if (!av && !bv) return 0;
  if (!av) return 1;
  if (!bv) return -1;
  const cmp = av.localeCompare(bv);
  return direction === 'asc' ? cmp : -cmp;
}

function compareSortDates(
  a: string | null | undefined,
  b: string | null | undefined,
  direction: SortDirection
): number {
  const at = a ? new Date(`${a}T12:00:00`).getTime() : Number.NaN;
  const bt = b ? new Date(`${b}T12:00:00`).getTime() : Number.NaN;
  if (Number.isNaN(at) && Number.isNaN(bt)) return 0;
  if (Number.isNaN(at)) return 1;
  if (Number.isNaN(bt)) return -1;
  const cmp = at - bt;
  return direction === 'asc' ? cmp : -cmp;
}

function hospDcSortValue(r: EpicConversionRecord): string | null {
  return r.hosp_dc_date ?? r.registration_date;
}

function losSortValue(r: EpicConversionRecord): number | null {
  if (r.los == null) return null;
  const parsed = Number(r.los);
  return Number.isNaN(parsed) ? null : parsed;
}

function compareEpicRecords(
  a: EpicConversionRecord,
  b: EpicConversionRecord,
  key: EpicTableSortKey,
  direction: SortDirection
): number {
  switch (key) {
    case 'pathway': {
      const primary = compareSortStrings(a.pathway, b.pathway, 'asc');
      if (primary !== 0) return direction === 'asc' ? primary : -primary;
      return compareSortStrings(a.care_path, b.care_path, direction);
    }
    case 'ic_lead':
      return compareSortStrings(a.ic_lead, b.ic_lead, direction);
    case 'hosp_dc':
      return compareSortDates(hospDcSortValue(a), hospDcSortValue(b), direction);
    case 'los': {
      const av = losSortValue(a);
      const bv = losSortValue(b);
      if (av == null && bv == null) {
        return compareSortStrings(a.los_category, b.los_category, direction);
      }
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = av - bv;
      return direction === 'asc' ? cmp : -cmp;
    }
    case 'latest_srv': {
      const av = a.days_since_lvd;
      const bv = b.days_since_lvd;
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = av - bv;
      return direction === 'asc' ? cmp : -cmp;
    }
  }
}

function sortEpicRecords(
  records: EpicConversionRecord[],
  sort: { key: EpicTableSortKey; direction: SortDirection }
): EpicConversionRecord[] {
  return [...records].sort((a, b) => compareEpicRecords(a, b, sort.key, sort.direction));
}

export function EpicConversionPage() {
  const {
    records,
    loading,
    error,
    refresh: refreshRecords,
    insertRows,
    setCompletion,
    setCarePlanCompletion,
    setEmarCompletion,
    clearCarePlanCompletionForRecords,
    changeFromDischargePending,
    changeFromEpisodeConversionPending,
    setDischargeDetails,
    submitDischarge,
    undoDischarge,
    setIclDecision,
    deleteImport,
  } = useEpicConversionRecords();
  const { user, profile } = useAuth();
  const {
    reportImports,
    reportError,
    latestSummary,
    unifiedSummary,
    importSummariesById,
    unifiedReconciliationDetails,
    unifiedDiscrepancyDetails,
    uploadReport,
    loadReconciliationDetails,
    loadUnifiedReconciliationDetails,
    recheckUnifiedReconciliation,
    recheckingUnified,
    refreshReports,
    fetchReportRowsForImport,
    deleteReport,
  } = useEpicConversionReports(records);
  const {
    imports: carePlanImports,
    carePlanRows,
    error: carePlanError,
    refresh: refreshCarePlanImports,
    uploadCarePlan,
    deleteCarePlanImport,
    fetchRowsForImport: fetchCarePlanRowsForImport,
  } = useEpicCarePlanImports();
  const {
    imports: emarImports,
    emarRows,
    error: emarError,
    refresh: refreshEmarImports,
    uploadEmar,
    deleteEmarImport,
    fetchRowsForImport: fetchEmarRowsForImport,
  } = useEpicEmarImports();
  const {
    imports: serviceDataImports,
    error: serviceDataError,
    refresh: refreshServiceDataImports,
    uploadServiceData,
    deleteServiceImport,
    fetchRowsForImport: fetchServiceDataRowsForImport,
    fetchDailyCountsForDateRange: fetchServiceDataDailyCountsForDateRange,
    fetchSsdbServiceDateBounds,
    fetchVisitCountsByEnrollIdInDateRange,
    fetchPatientSsdbServicesInDateRange,
    fetchMonthHasServices: fetchServiceDataMonthHasServices,
  } = useEpicSsdbServiceImports();
  const epicMapsContext = useEpicConversionMapsContextOptional();
  const importActivity = useMemo(() => computeImportActivity(records), [records]);
  const unifiedImportActivity = useMemo(
    () =>
      buildUnifiedImportActivity(
        importActivity,
        reportImports,
        importSummariesById,
        carePlanImports,
        carePlanRows
      ),
    [importActivity, reportImports, importSummariesById, carePlanImports, carePlanRows]
  );
  const [appReady, setAppReady] = useState(false);
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [uploadingImport, setUploadingImport] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [ssdbHowtoOpen, setSsdbHowtoOpen] = useState(false);
  const [importDialogPhase, setImportDialogPhase] = useState<ImportUploadDialogPhase>('form');
  const [importDialogFiles, setImportDialogFiles] = useState<ConsolidatedImportFiles>({
    enrolment: null,
    serviceData: null,
    carePlan: null,
    emar: null,
    epicReport: null,
  });
  const [importDialogError, setImportDialogError] = useState<string | null>(null);
  const [importDialogSuccessMessage, setImportDialogSuccessMessage] = useState<string | null>(
    null
  );
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccessMessage, setUploadSuccessMessage] = useState<string | null>(null);
  const [epicReportError, setEpicReportError] = useState<string | null>(null);
  const [carePlanUploadError, setCarePlanUploadError] = useState<string | null>(null);
  const [emarUploadError, setEmarUploadError] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'checked' | 'unchecked'>('all');
  const [pathwayFilter, setPathwayFilter] = useState<string[] | null>(null);
  const [carePathFilter, setCarePathFilter] = useState<string[] | null>(null);
  const [icLeadFilter, setIcLeadFilter] = useState<string[] | null>(null);
  const [losCategoryFilter, setLosCategoryFilter] = useState<string[] | null>(null);
  const [latestSrvFilter, setLatestSrvFilter] = useState<string[] | null>(null);
  const [stagedIclDecisions, setStagedIclDecisions] = useState<Map<string, IclDecisionValue>>(
    () => new Map()
  );
  const [submittingIclDecisions, setSubmittingIclDecisions] = useState(false);
  const [statusChangePrompt, setStatusChangePrompt] = useState<{
    record: EpicConversionRecord;
    flow: 'discharge' | 'episode';
  } | null>(null);
  const [stackExpandMode, setStackExpandMode] = useState<'none' | 'main' | 'split'>('none');
  const [reconciliationOutcomeFilter, setReconciliationOutcomeFilter] =
    useState<ReconciliationOutcomeFilter>('all');
  const [completionValidationFilter, setCompletionValidationFilter] =
    useState<CompletionValidationFilter>('all');
  const [epicTableSort, setEpicTableSort] = useState<{
    key: EpicTableSortKey;
    direction: SortDirection;
  } | null>(null);
  const [importTableSort, setImportTableSort] = useState<{
    key: ImportTableSortKey;
    direction: SortDirection;
  }>({ key: 'importedAt', direction: 'desc' });

  const toggleStackExpand = (target: 'main' | 'split') => {
    setStackExpandMode((prev) => (prev === target ? 'none' : target));
  };

  const pathwayOptions = useMemo(() => distinctOptions(records, (r) => r.pathway), [records]);
  const carePathOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of records) {
      if (!matchesMultiFilter(pathwayFilter, r.pathway, pathwayOptions)) continue;
      if (r.care_path) set.add(r.care_path);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [records, pathwayFilter, pathwayOptions]);
  const icLeadOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of records) {
      if (!matchesMultiFilter(pathwayFilter, r.pathway, pathwayOptions)) continue;
      if (r.ic_lead) set.add(r.ic_lead);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [records, pathwayFilter, pathwayOptions]);
  const losCategoryOptions = useMemo(
    () => sortLosCategoryOptions(distinctOptions(records, (r) => r.los_category)),
    [records]
  );
  const latestSrvOptions = useMemo(
    () => sortLatestSrvOptions(distinctOptions(records, (r) => r.latest_srv)),
    [records]
  );

  useEffect(() => {
    if (carePathFilter === null) return;
    const valid = carePathFilter.filter((carePath) => carePathOptions.includes(carePath));
    if (valid.length === carePathFilter.length) return;
    if (valid.length === 0) {
      setCarePathFilter([]);
    } else if (valid.length === carePathOptions.length) {
      setCarePathFilter(null);
    } else {
      setCarePathFilter(valid);
    }
  }, [carePathOptions, carePathFilter]);

  useEffect(() => {
    if (icLeadFilter === null) return;
    const valid = icLeadFilter.filter((icLead) => icLeadOptions.includes(icLead));
    if (valid.length === icLeadFilter.length) return;
    if (valid.length === 0) {
      setIcLeadFilter([]);
    } else if (valid.length === icLeadOptions.length) {
      setIcLeadFilter(null);
    } else {
      setIcLeadFilter(valid);
    }
  }, [icLeadOptions, icLeadFilter]);

  useEffect(() => {
    if (losCategoryFilter === null) return;
    const valid = losCategoryFilter.filter((losCategory) =>
      losCategoryOptions.includes(losCategory)
    );
    if (valid.length === losCategoryFilter.length) return;
    if (valid.length === 0) {
      setLosCategoryFilter([]);
    } else if (valid.length === losCategoryOptions.length) {
      setLosCategoryFilter(null);
    } else {
      setLosCategoryFilter(valid);
    }
  }, [losCategoryOptions, losCategoryFilter]);

  useEffect(() => {
    if (latestSrvFilter === null) return;
    const valid = latestSrvFilter.filter((latestSrv) => latestSrvOptions.includes(latestSrv));
    if (valid.length === latestSrvFilter.length) return;
    if (valid.length === 0) {
      setLatestSrvFilter([]);
    } else if (valid.length === latestSrvOptions.length) {
      setLatestSrvFilter(null);
    } else {
      setLatestSrvFilter(valid);
    }
  }, [latestSrvOptions, latestSrvFilter]);

  const imports = useMemo(() => {
    const byKey = new Map<
      string,
      { filename: string; importedAt: string; count: number; importedBy: string | null }
    >();
    for (const r of records) {
      const key = `${r.source_filename}\0${r.imported_at}`;
      const existing = byKey.get(key);
      if (existing) existing.count += 1;
      else
        byKey.set(key, {
          filename: r.source_filename,
          importedAt: r.imported_at,
          count: 1,
          importedBy: r.imported_by ?? null,
        });
    }
    return [...byKey.values()].sort(
      (a, b) => new Date(b.importedAt).getTime() - new Date(a.importedAt).getTime()
    );
  }, [records]);

  type ConsolidatedImportRow = {
    key: string;
    kind: ConsolidatedImportKind;
    documentType: string;
    importedAt: string;
    importedBy: string | null;
    filename: string;
    rowCount: number;
    enrolmentKey?: { filename: string; importedAt: string; count: number };
    serviceDataId?: string;
    carePlanId?: string;
    emarId?: string;
    reportId?: string;
  };

  const consolidatedImports = useMemo(() => {
    const rows: ConsolidatedImportRow[] = [];

    for (const imp of imports) {
      rows.push({
        key: `enrolment-${imp.filename}-${imp.importedAt}`,
        kind: 'enrolment',
        documentType: IMPORT_DOCUMENT_TYPE_LABELS.enrolment,
        importedAt: imp.importedAt,
        importedBy: imp.importedBy,
        filename: imp.filename,
        rowCount: imp.count,
        enrolmentKey: {
          filename: imp.filename,
          importedAt: imp.importedAt,
          count: imp.count,
        },
      });
    }

    for (const imp of serviceDataImports) {
      rows.push({
        key: `serviceData-${imp.id}`,
        kind: 'serviceData',
        documentType: IMPORT_DOCUMENT_TYPE_LABELS.serviceData,
        importedAt: imp.imported_at,
        importedBy: imp.imported_by,
        filename: imp.source_filename,
        rowCount: imp.row_count,
        serviceDataId: imp.id,
      });
    }

    for (const imp of carePlanImports) {
      rows.push({
        key: `carePlan-${imp.id}`,
        kind: 'carePlan',
        documentType: IMPORT_DOCUMENT_TYPE_LABELS.carePlan,
        importedAt: imp.imported_at,
        importedBy: imp.imported_by,
        filename: imp.source_filename,
        rowCount: imp.row_count,
        carePlanId: imp.id,
      });
    }

    for (const imp of emarImports) {
      rows.push({
        key: `emar-${imp.id}`,
        kind: 'emar',
        documentType: IMPORT_DOCUMENT_TYPE_LABELS.emar,
        importedAt: imp.imported_at,
        importedBy: imp.imported_by,
        filename: imp.source_filename,
        rowCount: imp.row_count,
        emarId: imp.id,
      });
    }

    for (const imp of reportImports) {
      rows.push({
        key: `epicReport-${imp.id}`,
        kind: 'epicReport',
        documentType: IMPORT_DOCUMENT_TYPE_LABELS.epicReport,
        importedAt: imp.imported_at,
        importedBy: imp.imported_by,
        filename: imp.source_filename,
        rowCount: imp.row_count,
        reportId: imp.id,
      });
    }

    return rows;
  }, [imports, serviceDataImports, carePlanImports, emarImports, reportImports]);

  const [uploaderByUserId, setUploaderByUserId] = useState<Map<string, BatchUploader>>(
    () => new Map()
  );

  useEffect(() => {
    const uploaderIds = [
      ...new Set(imports.map((imp) => imp.importedBy).filter((id): id is string => !!id)),
    ];
    if (!uploaderIds.length) {
      setUploaderByUserId(new Map());
      return;
    }

    let cancelled = false;
    void (async () => {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, display_name, email')
        .in('user_id', uploaderIds);

      if (cancelled) return;
      const next = new Map<string, BatchUploader>();
      for (const p of profiles ?? []) {
        if (p.user_id) {
          next.set(p.user_id, { display_name: p.display_name, email: p.email });
        }
      }
      setUploaderByUserId(next);
    })();

    return () => {
      cancelled = true;
    };
  }, [imports]);

  const [reportUploaderByUserId, setReportUploaderByUserId] = useState<Map<string, BatchUploader>>(
    () => new Map()
  );

  useEffect(() => {
    const uploaderIds = [
      ...new Set(reportImports.map((imp) => imp.imported_by).filter((id): id is string => !!id)),
    ];
    if (!uploaderIds.length) {
      setReportUploaderByUserId(new Map());
      return;
    }

    let cancelled = false;
    void (async () => {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, display_name, email')
        .in('user_id', uploaderIds);

      if (cancelled) return;
      const next = new Map<string, BatchUploader>();
      for (const p of profiles ?? []) {
        if (p.user_id) {
          next.set(p.user_id, { display_name: p.display_name, email: p.email });
        }
      }
      setReportUploaderByUserId(next);
    })();

    return () => {
      cancelled = true;
    };
  }, [reportImports]);

  const [carePlanUploaderByUserId, setCarePlanUploaderByUserId] = useState<
    Map<string, BatchUploader>
  >(() => new Map());

  useEffect(() => {
    const uploaderIds = [
      ...new Set(
        [...carePlanImports, ...emarImports]
          .map((imp) => imp.imported_by)
          .filter((id): id is string => !!id)
      ),
    ];
    if (!uploaderIds.length) {
      setCarePlanUploaderByUserId(new Map());
      return;
    }

    let cancelled = false;
    void (async () => {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, display_name, email')
        .in('user_id', uploaderIds);

      if (cancelled) return;
      const next = new Map<string, BatchUploader>();
      for (const p of profiles ?? []) {
        if (p.user_id) {
          next.set(p.user_id, { display_name: p.display_name, email: p.email });
        }
      }
      setCarePlanUploaderByUserId(next);
    })();

    return () => {
      cancelled = true;
    };
  }, [carePlanImports, emarImports]);

  // Stable tab list derived from all records (so tabs don't disappear when
  // filters reduce a strategy's rows to zero).
  const strategyTabs = useMemo(() => {
    const set = new Set<string>();
    let hasNull = false;
    for (const r of records) {
      if (r.episode_conversion_strategy) set.add(r.episode_conversion_strategy);
      else hasNull = true;
    }
    const tabs = sortStrategyTabs([...set]);
    if (hasNull) tabs.push(NO_STRATEGY_LABEL);
    return tabs;
  }, [records]);

  const [activeTab, setActiveTab] = useState<string | null>(PROGRESS_TRACKER_TAB);
  const isUploadTab = activeTab === UPLOAD_DATA_TAB;
  const isProgressTrackerTab = activeTab === PROGRESS_TRACKER_TAB;
  const isDiscrepanciesTab = activeTab === EPISODE_VALIDATION_TAB;
  const isCarePlanTab = activeTab === CARE_PLAN_CONVERSION_TAB;
  const isServiceDataTab = activeTab === SERVICE_DATA_CONVERSION_TAB;
  const isSpecialTab =
    isUploadTab ||
    isProgressTrackerTab ||
    isDiscrepanciesTab ||
    isCarePlanTab ||
    isServiceDataTab;

  const isEpisodeConversionTab = activeTab === EPISODE_CONVERSION_STRATEGY;

  useEffect(() => {
    if ((!isProgressTrackerTab && !isDiscrepanciesTab) || !latestSummary) return;
    void loadReconciliationDetails(latestSummary.importId);
  }, [isProgressTrackerTab, isDiscrepanciesTab, latestSummary, loadReconciliationDetails]);

  useEffect(() => {
    if (
      (!isDiscrepanciesTab && !isEpisodeConversionTab && !isProgressTrackerTab) ||
      !reportImports.length
    ) {
      return;
    }
    void loadUnifiedReconciliationDetails();
  }, [
    isDiscrepanciesTab,
    isEpisodeConversionTab,
    isProgressTrackerTab,
    reportImports.length,
    records,
    loadUnifiedReconciliationDetails,
  ]);

  useEffect(() => {
    if (!loading) setAppReady(true);
  }, [loading]);

  const handleRefreshAll = useCallback(async () => {
    if (refreshingAll) return;
    setRefreshingAll(true);
    try {
      await Promise.all([
        refreshRecords(),
        refreshReports(),
        refreshCarePlanImports(),
        refreshEmarImports(),
        refreshServiceDataImports(),
        epicMapsContext?.refresh() ?? Promise.resolve(),
      ]);
      await loadUnifiedReconciliationDetails();
    } finally {
      setRefreshingAll(false);
    }
  }, [
    refreshingAll,
    refreshRecords,
    refreshReports,
    refreshCarePlanImports,
    refreshEmarImports,
    refreshServiceDataImports,
    epicMapsContext,
    loadUnifiedReconciliationDetails,
  ]);

  const latestEpicImportedAt = useMemo(
    () =>
      reportImports.length > 0
        ? getLatestEpicImportedAt(reportImports.map((imp) => imp.imported_at))
        : null,
    [reportImports]
  );

  const recordsById = useMemo(() => new Map(records.map((r) => [r.id, r])), [records]);

  const validatedRecordIds = useMemo(() => {
    const ids = new Set<string>();
    for (const row of unifiedReconciliationDetails) {
      if (!row.matchedRecordId || !isValidatedOutcome(row.outcome)) continue;
      const record = recordsById.get(row.matchedRecordId);
      if (record && isConversionPendingEpicAdjudication(record, latestEpicImportedAt)) {
        continue;
      }
      ids.add(row.matchedRecordId);
    }
    return ids;
  }, [unifiedReconciliationDetails, recordsById, latestEpicImportedAt]);

  const carePlanImportFilenames = useMemo(
    () => new Map(carePlanImports.map((imp) => [imp.id, imp.source_filename])),
    [carePlanImports]
  );

  const emarImportFilenames = useMemo(
    () => new Map(emarImports.map((imp) => [imp.id, imp.source_filename])),
    [emarImports]
  );

  const fetchServiceDataDailyCountsWithCarePlanLink = useCallback(
    async (startDate: string, endDate: string) => {
      const rawCounts = await fetchServiceDataDailyCountsForDateRange(startDate, endDate);
      const recordByEnrollId = buildRecordByEnrollId(records);
      const counts = hasActiveServiceDayPatientFilter(search, icLeadFilter)
        ? aggregateSsdbServiceDayRows(
            rawCounts.ssdbServiceRows.filter((row) =>
              ssdbServiceRowMatchesPatientFilter(
                row,
                recordByEnrollId,
                search,
                icLeadFilter,
                icLeadOptions
              )
            )
          )
        : rawCounts;
      const templatedCarePlanPercentByDate =
        carePlanImports.length > 0
          ? computeTemplatedCarePlanPercentByServiceDay(
              counts.enrollIdsByDate,
              records,
              carePlanRows
            )
          : new Map<string, number>();
      const templatedCarePlanPercentByWeekStart =
        carePlanImports.length > 0
          ? computeTemplatedCarePlanPercentByServiceWeek(
              counts.enrollIdsByWeekStart,
              records,
              carePlanRows
            )
          : new Map<string, number>();
      const templatedCarePlanCountByDate =
        carePlanImports.length > 0
          ? computeTemplatedCarePlanCountByServiceDay(
              counts.enrollIdsByDate,
              records,
              carePlanRows
            )
          : new Map<string, number>();
      const templatedCarePlanCountByWeekStart =
        carePlanImports.length > 0
          ? computeTemplatedCarePlanCountByServiceWeek(
              counts.enrollIdsByWeekStart,
              records,
              carePlanRows
            )
          : new Map<string, number>();
      const patientsByDate = computeServiceDayPatientsByDate(
        counts.enrollIdsByDate,
        counts.ssdbPatientByDate,
        records,
        carePlanRows,
        carePlanImports.length > 0
      );
      const services = computeServiceDayServices(
        counts.ssdbServiceRows,
        records,
        carePlanRows,
        carePlanImports.length > 0
      );

      return {
        serviceCountsByDate: counts.serviceCountsByDate,
        patientCountsByDate: counts.patientCountsByDate,
        weekServiceCountsByWeekStart: counts.weekServiceCountsByWeekStart,
        weekPatientCountsByWeekStart: counts.weekPatientCountsByWeekStart,
        hasChangedServiceByDate: counts.hasChangedServiceByDate,
        hasChangedServiceByWeekStart: counts.hasChangedServiceByWeekStart,
        cancelledServiceCountByDate: counts.cancelledServiceCountByDate,
        cancelledServiceCountByWeekStart: counts.cancelledServiceCountByWeekStart,
        templatedCarePlanPercentByDate,
        templatedCarePlanPercentByWeekStart,
        templatedCarePlanCountByDate,
        templatedCarePlanCountByWeekStart,
        patientsByDate,
        services,
        error: rawCounts.error,
      };
    },
    [
      fetchServiceDataDailyCountsForDateRange,
      carePlanImports.length,
      records,
      carePlanRows,
      search,
      icLeadFilter,
      icLeadOptions,
    ]
  );

  const fetchPatientServicesInDateRange = useCallback(
    async (enrollId: string, startDate: string, endDate: string) => {
      const { rows, error } = await fetchPatientSsdbServicesInDateRange(
        enrollId,
        startDate,
        endDate
      );
      const services = computeServiceDayServices(
        rows,
        records,
        carePlanRows,
        carePlanImports.length > 0
      );
      return {
        services,
        serviceDetailsByCalendarKey: indexPatientSsdbServiceDetails(rows),
        error,
      };
    },
    [
      fetchPatientSsdbServicesInDateRange,
      records,
      carePlanRows,
      carePlanImports.length,
    ]
  );

  const { patientLinks: carePlanPatientLinks } = useCarePlanConversionData(
    records,
    carePlanRows,
    carePlanImportFilenames,
    validatedRecordIds,
    emarRows,
    emarImportFilenames
  );
  const carePlanServiceDataRefreshKey = useMemo(
    () =>
      serviceDataImports
        .map((imp) => `${imp.id}:${imp.imported_at}:${imp.row_count}`)
        .join('|'),
    [serviceDataImports]
  );
  const carePlanDefaultTabPendingCount = useCarePlanDefaultTabPendingCount(
    carePlanPatientLinks,
    serviceDataImports.length > 0,
    carePlanServiceDataRefreshKey,
    fetchSsdbServiceDateBounds,
    fetchVisitCountsByEnrollIdInDateRange
  );
  const [carePlanToolbarPendingCount, setCarePlanToolbarPendingCount] = useState<number | null>(
    null
  );
  const carePlanTabCount = carePlanToolbarPendingCount ?? carePlanDefaultTabPendingCount;

  useEffect(() => {
    if (!isCarePlanTab) {
      setCarePlanToolbarPendingCount(null);
    }
  }, [isCarePlanTab]);

  const epicValidationByRecordId = useMemo(
    () =>
      buildEpicValidationStatusByRecordId(
        unifiedReconciliationDetails,
        reportImports.length > 0,
        { recordsById, latestEpicImportedAt }
      ),
    [unifiedReconciliationDetails, reportImports.length, recordsById, latestEpicImportedAt]
  );

  const epicSnapshotByRecordId = useMemo(
    () => buildEpicSnapshotByMatchedRecordId(unifiedReconciliationDetails),
    [unifiedReconciliationDetails]
  );

  const showEpicSnapshotColumn = reportImports.length > 0;

  const goLiveVisitWindowRange = useMemo<CarePlanDateRange>(
    () => ({ from: GO_LIVE_DATE, to: DEFAULT_SSDB_VISIT_TO_DATE }),
    []
  );
  const [limitProgressToGoLiveVisitWindow, setLimitProgressToGoLiveVisitWindow] = useState(true);
  const [progressVisitCountsByEnrollId, setProgressVisitCountsByEnrollId] = useState<Map<
    string,
    number
  > | null>(null);

  useEffect(() => {
    if (serviceDataImports.length === 0) {
      setProgressVisitCountsByEnrollId(null);
      return;
    }

    let cancelled = false;
    void fetchVisitCountsByEnrollIdInDateRange(
      goLiveVisitWindowRange.from,
      goLiveVisitWindowRange.to
    ).then(({ visitCountsByEnrollId: counts }) => {
      if (!cancelled) {
        setProgressVisitCountsByEnrollId(counts);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [
    serviceDataImports.length,
    carePlanServiceDataRefreshKey,
    goLiveVisitWindowRange,
    fetchVisitCountsByEnrollIdInDateRange,
  ]);

  const progressVisitWindowFilter = useMemo(() => {
    if (
      !limitProgressToGoLiveVisitWindow ||
      serviceDataImports.length === 0 ||
      progressVisitCountsByEnrollId === null
    ) {
      return undefined;
    }
    return {
      range: goLiveVisitWindowRange,
      visitCountsByEnrollId: progressVisitCountsByEnrollId,
    };
  }, [
    limitProgressToGoLiveVisitWindow,
    serviceDataImports.length,
    progressVisitCountsByEnrollId,
    goLiveVisitWindowRange,
  ]);

  const progressMetrics = useMemo(
    () =>
      computeProgressMetrics(
        records,
        new Date(),
        reportImports.length > 0 ? validatedRecordIds : undefined
      ),
    [records, validatedRecordIds, reportImports.length]
  );

  const carePlanProgressMetrics = useMemo(
    () => computeCarePlanProgressMetrics(carePlanPatientLinks, progressVisitWindowFilter),
    [carePlanPatientLinks, progressVisitWindowFilter]
  );
  const dailyProgressSeries = useMemo(() => computeDailyProgressSeries(records), [records]);

  const discrepancyCount = unifiedDiscrepancyDetails.length;
  const filteredReconciliationDetails = useMemo(
    () =>
      unifiedReconciliationDetails.filter((row) => {
        if (!matchesReconciliationOutcomeFilter(row.outcome, reconciliationOutcomeFilter)) {
          return false;
        }
        const record = row.matchedRecordId ? recordsById.get(row.matchedRecordId) : undefined;
        return !record || !isConversionPendingEpicAdjudication(record, latestEpicImportedAt);
      }),
    [unifiedReconciliationDetails, reconciliationOutcomeFilter, recordsById, latestEpicImportedAt]
  );

  useEffect(() => {
    if (loading) return;
    if (strategyTabs.length === 0) {
      if (activeTab !== UPLOAD_DATA_TAB) setActiveTab(UPLOAD_DATA_TAB);
      return;
    }
    if (
      activeTab === UPLOAD_DATA_TAB ||
      activeTab === PROGRESS_TRACKER_TAB ||
      activeTab === EPISODE_VALIDATION_TAB ||
      activeTab === CARE_PLAN_CONVERSION_TAB ||
      activeTab === SERVICE_DATA_CONVERSION_TAB
    ) {
      return;
    }
    if (!activeTab || !strategyTabs.includes(activeTab)) {
      setActiveTab(PROGRESS_TRACKER_TAB);
    }
  }, [strategyTabs, activeTab, loading]);

  const isIclTab = activeTab === ICL_REASSESSMENT_STRATEGY;
  const isDischargeTab = activeTab === DISCHARGE_STRATEGY;

  useEffect(() => {
    setStackExpandMode('none');
  }, [activeTab]);

  useEffect(() => {
    setCompletionValidationFilter('all');
  }, [activeTab]);

  const toggleEpicTableSort = (key: EpicTableSortKey) => {
    setEpicTableSort((prev) => {
      if (prev?.key === key) {
        return { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
      }
      return { key, direction: 'asc' };
    });
  };

  const toggleImportTableSort = (key: ImportTableSortKey) => {
    setImportTableSort((prev) => {
      if (prev.key === key) {
        return { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
      }
      return { key, direction: 'asc' };
    });
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return records.filter((r) => {
      if (isEpisodeConversionTab) {
        if (!matchesMultiFilter(losCategoryFilter, r.los_category, losCategoryOptions)) {
          return false;
        }
        if (!matchesMultiFilter(latestSrvFilter, r.latest_srv, latestSrvOptions)) {
          return false;
        }
      } else if (!isIclTab) {
        if (statusFilter === 'checked' && !r.completed_at) return false;
        if (statusFilter === 'unchecked' && r.completed_at) return false;
      }
      if (!matchesMultiFilter(pathwayFilter, r.pathway, pathwayOptions)) return false;
      if (!matchesMultiFilter(carePathFilter, r.care_path, carePathOptions)) return false;
      if (!matchesMultiFilter(icLeadFilter, r.ic_lead, icLeadOptions)) return false;
      if (!q) return true;
      return (
        r.mrn.toLowerCase().includes(q) ||
        (r.gcn?.toLowerCase().includes(q) ?? false) ||
        (r.ic_lead?.toLowerCase().includes(q) ?? false) ||
        (r.pathway?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [
    records,
    search,
    statusFilter,
    pathwayFilter,
    carePathFilter,
    icLeadFilter,
    losCategoryFilter,
    latestSrvFilter,
    isIclTab,
    isEpisodeConversionTab,
    pathwayOptions,
    carePathOptions,
    icLeadOptions,
    losCategoryOptions,
    latestSrvOptions,
  ]);

  const hasActiveToolbarFilters =
    search.trim() !== '' ||
    pathwayFilter !== null ||
    carePathFilter !== null ||
    icLeadFilter !== null ||
    losCategoryFilter !== null ||
    latestSrvFilter !== null;

  const clearToolbarFilters = () => {
    setSearch('');
    setPathwayFilter(null);
    setCarePathFilter(null);
    setIcLeadFilter(null);
    setLosCategoryFilter(null);
    setLatestSrvFilter(null);
  };


  // Per-tab counts reflect the active filters and match each tab's main panel.
  const countsByStrategy = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of filtered) {
      for (const tab of strategyTabs) {
        if (recordBelongsToStrategyTabBadge(r, tab)) {
          map.set(tab, (map.get(tab) ?? 0) + 1);
        }
      }
    }
    return map;
  }, [filtered, strategyTabs]);

  const activeRecords = useMemo(() => {
    if (isSpecialTab || !activeTab) return [];
    return filtered.filter((r) => recordBelongsToStrategyTab(r, activeTab));
  }, [filtered, activeTab, isSpecialTab]);

  const episodeConversionPendingRecords = useMemo(() => {
    if (!isEpisodeConversionTab) return [];
    return activeRecords.filter((r) => !r.completed_at);
  }, [activeRecords, isEpisodeConversionTab]);

  const episodeConversionCompletedRecords = useMemo(() => {
    if (!isEpisodeConversionTab) return [];
    return activeRecords.filter((r) => r.completed_at != null);
  }, [activeRecords, isEpisodeConversionTab]);

  const episodeConversionValidationCounts = useMemo(
    () =>
      countEpicValidationStatuses(
        episodeConversionCompletedRecords,
        epicValidationByRecordId
      ),
    [episodeConversionCompletedRecords, epicValidationByRecordId]
  );

  const filteredEpisodeConversionCompletedRecords = useMemo(() => {
    if (completionValidationFilter === 'all') return episodeConversionCompletedRecords;
    return episodeConversionCompletedRecords.filter(
      (record) =>
        getRecordValidationKind(record.id, epicValidationByRecordId) ===
        completionValidationFilter
    );
  }, [
    episodeConversionCompletedRecords,
    completionValidationFilter,
    epicValidationByRecordId,
  ]);

  const dischargePendingRecords = useMemo(() => {
    if (!isDischargeTab) return [];
    return activeRecords.filter((r) => r.status !== 'discharged');
  }, [activeRecords, isDischargeTab]);

  const dischargeSubmittedRecords = useMemo(() => {
    if (!isDischargeTab) return [];
    return activeRecords.filter((r) => r.status === 'discharged');
  }, [activeRecords, isDischargeTab]);

  const iclPendingRecords = useMemo(() => {
    if (!isIclTab) return [];
    return filtered.filter((r) => recordNeedsIclReassessment(r));
  }, [filtered, isIclTab]);

  const iclPendingIdSet = useMemo(
    () => new Set(iclPendingRecords.map((r) => r.id)),
    [iclPendingRecords]
  );

  useEffect(() => {
    setStagedIclDecisions((prev) => {
      const next = new Map([...prev].filter(([id]) => iclPendingIdSet.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [iclPendingIdSet]);

  const stagedConvertCount = useMemo(
    () => [...stagedIclDecisions.values()].filter((decision) => decision === 'convert').length,
    [stagedIclDecisions]
  );

  const stagedDischargeCount = useMemo(
    () => [...stagedIclDecisions.values()].filter((decision) => decision === 'discharge').length,
    [stagedIclDecisions]
  );

  const stagedIclDecisionCount = stagedIclDecisions.size;

  const iclConvertRecords = useMemo(() => {
    if (!isIclTab) return [];
    return filtered.filter(
      (r) =>
        r.episode_conversion_strategy === ICL_REASSESSMENT_STRATEGY &&
        r.icl_decision === 'convert'
    );
  }, [filtered, isIclTab]);

  const iclDischargeRecords = useMemo(() => {
    if (!isIclTab) return [];
    return filtered.filter(
      (r) =>
        r.episode_conversion_strategy === ICL_REASSESSMENT_STRATEGY &&
        r.icl_decision === 'discharge'
    );
  }, [filtered, isIclTab]);

  const handleEnrolmentUpload = async (
    file: File
  ): Promise<{ ok: true; message: string } | { ok: false; error: string }> => {
    setUploadError(null);
    setUploadSuccessMessage(null);
    try {
      const buf = await file.arrayBuffer();
      const parsed = parseEpicConversionXlsxBuffer(buf, file.name);
      if (parsed.errors.length) {
        const error = parsed.errors.slice(0, 4).join('; ');
        setUploadError(error);
        return { ok: false, error };
      }

      const insertOptions = parsed.isVhaSsdb
        ? {
            ssdbUploadEnrollIds: new Set(
              parsed.rows
                .map((row) => row.enroll_id)
                .filter((id): id is string => !!id)
            ),
            dischargedBy: emailToUsername(user?.email ?? profile?.email),
          }
        : undefined;

      const result = await insertRows(parsed.rows, user?.id ?? null, insertOptions);
      if (result.error) {
        setUploadError(result.error);
        return { ok: false, error: result.error };
      }

      const breakdown = formatStrategyBreakdown(result.strategyBreakdown);
      const parts: string[] = [];
      if (result.inserted > 0) {
        parts.push(
          `Inserted ${result.inserted} net-new record${result.inserted === 1 ? '' : 's'} (${breakdown}).`
        );
      }
      if (result.updated > 0) {
        parts.push(
          `Updated ${result.updated} existing record${result.updated === 1 ? '' : 's'} with changes from this file.`
        );
      }
      if (result.inserted === 0 && result.updated === 0) {
        if (result.unchanged > 0 || result.skippedDuplicates > 0) {
          const unchangedCount = result.unchanged || result.skippedDuplicates;
          parts.push(
            `No changes detected. ${unchangedCount} existing record${unchangedCount === 1 ? '' : 's'} already match this file.`
          );
        } else {
          parts.push('Upload completed with no rows to process.');
        }
      }
      if (result.autoDischarged > 0) {
        parts.push(
          `Marked ${result.autoDischarged} enrollee${result.autoDischarged === 1 ? '' : 's'} absent from this SSDB as discharged from program.`
        );
      }
      if (parsed.skipped > 0) {
        parts.push(
          `${parsed.skipped} row${parsed.skipped === 1 ? '' : 's'} skipped during parse.`
        );
      }
      const message = parts.join(' ');
      setUploadSuccessMessage(message);
      return { ok: true, message };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Upload failed';
      setUploadError(error);
      return { ok: false, error };
    }
  };

  const resolveImportUploaderName = (
    kind: ConsolidatedImportKind,
    importedBy: string | null
  ): string => {
    if (!importedBy) return 'Unknown';
    const uploader =
      kind === 'enrolment' || kind === 'serviceData'
        ? uploaderByUserId.get(importedBy)
        : kind === 'carePlan' || kind === 'emar'
          ? carePlanUploaderByUserId.get(importedBy)
          : reportUploaderByUserId.get(importedBy);
    return uploaderLabel(uploader);
  };

  const sortedConsolidatedImports = useMemo(() => {
    const withLabels = consolidatedImports.map((imp) => ({
      imp,
      documentType: imp.documentType,
      importedAt: imp.importedAt,
      uploadedByLabel: resolveImportUploaderName(imp.kind, imp.importedBy),
    }));
    return [...withLabels]
      .sort((a, b) =>
        compareConsolidatedImportRows(a, b, importTableSort.key, importTableSort.direction)
      )
      .map((row) => row.imp);
  }, [
    consolidatedImports,
    importTableSort,
    uploaderByUserId,
    carePlanUploaderByUserId,
    reportUploaderByUserId,
  ]);

  const renderImportSortableHeader = (
    label: string,
    key: ImportTableSortKey,
    className: string
  ) => {
    const active = importTableSort.key === key;
    const direction = active ? importTableSort.direction : null;
    return (
      <th className={className}>
        <button
          type="button"
          className={`hc-table-sort${direction ? ` hc-table-sort--${direction}` : ''}`}
          aria-sort={direction ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}
          onClick={() => toggleImportTableSort(key)}
        >
          {label}
          <span className="hc-table-sort-indicator" aria-hidden />
        </button>
      </th>
    );
  };

  const openImportDialog = () => {
    setImportDialogOpen(true);
    setImportDialogPhase('form');
    setImportDialogFiles({
      enrolment: null,
      serviceData: null,
      carePlan: null,
      emar: null,
      epicReport: null,
    });
    setImportDialogError(null);
    setImportDialogSuccessMessage(null);
  };

  const closeImportDialog = () => {
    setImportDialogOpen(false);
    setImportDialogPhase('form');
    setImportDialogFiles({
      enrolment: null,
      serviceData: null,
      carePlan: null,
      emar: null,
      epicReport: null,
    });
    setImportDialogError(null);
    setImportDialogSuccessMessage(null);
  };

  const handleImportDialogFileChange = (kind: ConsolidatedImportKind, file: File | null) => {
    setImportDialogFiles((prev) => ({ ...prev, [kind]: file }));
    setImportDialogError(null);
  };

  const handleImportDialogSubmit = async () => {
    const { enrolment, serviceData, carePlan, emar, epicReport } = importDialogFiles;
    if (!enrolment && !serviceData && !carePlan && !emar && !epicReport) return;

    setImportDialogPhase('processing');
    setImportDialogError(null);
    setUploadingImport(true);

    const errors: string[] = [];
    const successParts: string[] = [];

    if (enrolment) {
      setUploadError(null);
      setUploadSuccessMessage(null);
      const result = await handleEnrolmentUpload(enrolment);
      if (result.ok) {
        successParts.push(IMPORT_DOCUMENT_TYPE_LABELS.enrolment);
        setUploadSuccessMessage(result.message);
      } else {
        errors.push(`${IMPORT_DOCUMENT_TYPE_LABELS.enrolment}: ${result.error}`);
      }
    }

    if (serviceData) {
      const result = await uploadServiceData(serviceData, user?.id ?? null);
      if (result.error) {
        errors.push(`${IMPORT_DOCUMENT_TYPE_LABELS.serviceData}: ${result.error}`);
      } else {
        successParts.push(`${IMPORT_DOCUMENT_TYPE_LABELS.serviceData} (${result.message ?? 'done'})`);
        if (result.message) {
          setUploadSuccessMessage(result.message);
        }
      }
    }

    if (carePlan) {
      setCarePlanUploadError(null);
      const result = await uploadCarePlan(carePlan, user?.id ?? null);
      if (result.error) {
        errors.push(`${IMPORT_DOCUMENT_TYPE_LABELS.carePlan}: ${result.error}`);
      } else {
        const importFilenames = new Map(
          result.imports.map((imp) => [imp.id, imp.source_filename])
        );
        const refreshedLinks = buildCarePlanPatientLinks(
          records,
          result.carePlanRows,
          validatedRecordIds,
          importFilenames,
          emarRows,
          emarImportFilenames
        );
        const recordIdsToRecheck = findCompletedRecordIdsNeedingCarePlanRecheck(refreshedLinks);
        if (recordIdsToRecheck.length > 0) {
          const { error: recheckError } = await clearCarePlanCompletionForRecords(
            recordIdsToRecheck
          );
          if (recheckError) {
            errors.push(`${IMPORT_DOCUMENT_TYPE_LABELS.carePlan}: ${recheckError}`);
          }
        }

        if (!errors.some((message) => message.startsWith(IMPORT_DOCUMENT_TYPE_LABELS.carePlan))) {
          if (result.rowCount > 0) {
            const dupNote =
              result.skippedDuplicates > 0
                ? `, ${result.skippedDuplicates} duplicate${result.skippedDuplicates === 1 ? '' : 's'} skipped`
                : '';
            successParts.push(
              `${IMPORT_DOCUMENT_TYPE_LABELS.carePlan} (${result.rowCount} row${result.rowCount === 1 ? '' : 's'}${dupNote})`
            );
          } else if (result.skippedDuplicates > 0) {
            successParts.push(
              `${IMPORT_DOCUMENT_TYPE_LABELS.carePlan} (no new rows; ${result.skippedDuplicates} duplicate${result.skippedDuplicates === 1 ? '' : 's'} skipped)`
            );
          }
        }
      }
    }

    if (emar) {
      setEmarUploadError(null);
      const result = await uploadEmar(emar, user?.id ?? null);
      if (result.error) {
        errors.push(`${IMPORT_DOCUMENT_TYPE_LABELS.emar}: ${result.error}`);
      } else {
        if (result.rowCount > 0) {
          const dupNote =
            result.skippedDuplicates > 0
              ? `, ${result.skippedDuplicates} duplicate${result.skippedDuplicates === 1 ? '' : 's'} skipped`
              : '';
          const linkedNote =
            result.linkedCount > 0
              ? `, ${result.linkedCount} linked to enrolment`
              : '';
          successParts.push(
            `${IMPORT_DOCUMENT_TYPE_LABELS.emar} (${result.rowCount} row${result.rowCount === 1 ? '' : 's'}${linkedNote}${dupNote})`
          );
        } else if (result.skippedDuplicates > 0) {
          successParts.push(
            `${IMPORT_DOCUMENT_TYPE_LABELS.emar} (no new rows; ${result.skippedDuplicates} duplicate${result.skippedDuplicates === 1 ? '' : 's'} skipped)`
          );
        }
      }
    }

    if (epicReport) {
      setEpicReportError(null);
      const result = await uploadReport(epicReport, user?.id ?? null);
      if (result.error) {
        errors.push(`${IMPORT_DOCUMENT_TYPE_LABELS.epicReport}: ${result.error}`);
      } else if (result.summary) {
        const { totalRows, validated, unmatched, fieldDiscrepancy, statusDiscrepancy } =
          result.summary;
        successParts.push(
          `${IMPORT_DOCUMENT_TYPE_LABELS.epicReport} (${totalRows} row${totalRows === 1 ? '' : 's'}; ${validated} validated, ${unmatched} unmatched, ${fieldDiscrepancy + statusDiscrepancy} with discrepancies)`
        );
      } else {
        errors.push(`${IMPORT_DOCUMENT_TYPE_LABELS.epicReport}: Upload completed with no summary.`);
      }
    }

    setUploadingImport(false);

    if (errors.length > 0) {
      setImportDialogError(errors.join(' '));
      setImportDialogPhase('form');
      return;
    }

    setImportDialogSuccessMessage(
      successParts.length === 1
        ? `${successParts[0]} imported successfully. The data in this app has been refreshed.`
        : `Imported ${successParts.length} files successfully (${successParts.join('; ')}). The data in this app has been refreshed.`
    );
    setImportDialogPhase('success');
  };

  const handleDeleteReportImport = async (importId: string, filename: string) => {
    if (!window.confirm(`Delete Epic report "${filename}" and its reconciliation results?`)) return;
    const { error: err } = await deleteReport(importId);
    if (err) setEpicReportError(err);
  };

  const handleDeleteCarePlanImport = async (importId: string, filename: string) => {
    if (!window.confirm(`Delete care plan import "${filename}"? This cannot be undone.`)) return;
    const { error: err } = await deleteCarePlanImport(importId);
    if (err) setCarePlanUploadError(err);
  };

  const handleDeleteEmarImport = async (importId: string, filename: string) => {
    if (!window.confirm(`Delete eMAR import "${filename}"? This cannot be undone.`)) return;
    const { error: err } = await deleteEmarImport(importId);
    if (err) setEmarUploadError(err);
  };

  const handleDeleteServiceDataImport = async (importId: string, filename: string) => {
    if (
      !window.confirm(
        `Delete service data import "${filename}"? This removes the import record from history; service rows already ingested remain in the database.`
      )
    ) {
      return;
    }
    const { error: err } = await deleteServiceImport(importId);
    if (err) setUploadError(err);
  };

  const handleIclDecisionChange = async (record: EpicConversionRecord, decision: IclDecision) => {
    const decisionBy =
      decision === 'pending' ? null : emailToUsername(user?.email ?? profile?.email);
    setUpdatingId(record.id);
    setStatusError(null);
    const { error: err } = await setIclDecision(record.id, decision, decisionBy);
    if (err) setStatusError(err);
    setUpdatingId(null);
  };

  const setStagedIclDecision = (
    id: string,
    decision: IclDecisionValue,
    checked: boolean
  ) => {
    setStagedIclDecisions((prev) => {
      const next = new Map(prev);
      if (checked) next.set(id, decision);
      else if (next.get(id) === decision) next.delete(id);
      return next;
    });
  };

  const handleSubmitStagedIclDecisions = async () => {
    const entries = [...stagedIclDecisions.entries()];
    if (entries.length === 0) return;

    const decisionBy = emailToUsername(user?.email ?? profile?.email);
    setSubmittingIclDecisions(true);
    setStatusError(null);

    const results = await Promise.all(
      entries.map(([id, decision]) => setIclDecision(id, decision, decisionBy))
    );
    const err = results.find((result) => result.error)?.error;
    if (err) setStatusError(err);
    else setStagedIclDecisions(new Map());
    setSubmittingIclDecisions(false);
  };

  const handleToggleCompleted = async (record: EpicConversionRecord, checked: boolean) => {
    const completedBy = checked ? emailToUsername(user?.email ?? profile?.email) : null;
    setUpdatingId(record.id);
    setStatusError(null);
    const { error: err } = await setCompletion(record.id, completedBy);
    if (err) setStatusError(err);
    setUpdatingId(null);
  };

  const handleToggleCarePlanCompleted = async (recordId: string, completed: boolean) => {
    const completedBy = completed ? emailToUsername(user?.email ?? profile?.email) : null;
    setUpdatingId(recordId);
    setStatusError(null);
    const { error: err } = await setCarePlanCompletion(recordId, completedBy);
    if (err) setStatusError(err);
    setUpdatingId(null);
  };

  const handleToggleEmarCompleted = async (recordId: string, completed: boolean) => {
    const completedBy = completed ? emailToUsername(user?.email ?? profile?.email) : null;
    setUpdatingId(recordId);
    setStatusError(null);
    const { error: err } = await setEmarCompletion(recordId, completedBy);
    if (err) setStatusError(err);
    setUpdatingId(null);
  };

  const handleDischargeDateSourceChange = async (
    record: EpicConversionRecord,
    source: DischargeDateSource
  ) => {
    const customDate =
      source === 'other'
        ? record.discharge_date_source === 'other'
          ? record.discharge_date
          : null
        : null;
    const discharge_date = resolveDischargeDate(record, source, customDate);
    setUpdatingId(record.id);
    setStatusError(null);
    const { error: err } = await setDischargeDetails(record.id, {
      discharge_date_source: source,
      discharge_date,
      discharge_reason: record.discharge_reason,
    });
    if (err) setStatusError(err);
    setUpdatingId(null);
  };

  const handleDischargeCustomDateChange = async (
    record: EpicConversionRecord,
    customDate: string
  ) => {
    setUpdatingId(record.id);
    setStatusError(null);
    const { error: err } = await setDischargeDetails(record.id, {
      discharge_date_source: 'other',
      discharge_date: customDate || null,
      discharge_reason: record.discharge_reason,
    });
    if (err) setStatusError(err);
    setUpdatingId(null);
  };

  const handleDischargeReasonChange = async (record: EpicConversionRecord, reason: string) => {
    setUpdatingId(record.id);
    setStatusError(null);
    const { error: err } = await setDischargeDetails(record.id, {
      discharge_date_source: record.discharge_date_source,
      discharge_date: record.discharge_date,
      discharge_reason: reason || null,
    });
    if (err) setStatusError(err);
    setUpdatingId(null);
  };

  const handleSubmitDischarge = async (record: EpicConversionRecord) => {
    if (!isDischargeSubmitReady(record, computePddDate(record))) return;
    const dischargedBy = emailToUsername(user?.email ?? profile?.email);
    setUpdatingId(record.id);
    setStatusError(null);
    const { error: err } = await submitDischarge(record.id, dischargedBy);
    if (err) setStatusError(err);
    setUpdatingId(null);
  };

  const handleUndoDischarge = async (record: EpicConversionRecord) => {
    setUpdatingId(record.id);
    setStatusError(null);
    const { error: err } = await undoDischarge(record.id);
    if (err) setStatusError(err);
    setUpdatingId(null);
  };

  const confirmStatusChange = async (target: 'icl' | 'episode' | 'discharge') => {
    const prompt = statusChangePrompt;
    if (!prompt) return;

    const { record, flow } = prompt;
    if (flow === 'discharge' && target === 'discharge') return;
    if (flow === 'episode' && target === 'episode') return;

    const decisionBy = emailToUsername(user?.email ?? profile?.email);
    setUpdatingId(record.id);
    setStatusError(null);

    const result =
      flow === 'discharge' && (target === 'icl' || target === 'episode')
        ? await changeFromDischargePending(
            record.id,
            target,
            { episode_conversion_strategy: record.episode_conversion_strategy },
            target === 'episode' ? decisionBy : null
          )
        : flow === 'episode' && (target === 'icl' || target === 'discharge')
          ? await changeFromEpisodeConversionPending(
              record.id,
              target,
              {
                episode_conversion_strategy: record.episode_conversion_strategy,
                icl_decision: record.icl_decision,
              },
              target === 'discharge' ? decisionBy : null
            )
          : { error: 'Invalid status change.' };

    if (result.error) {
      setStatusError(result.error);
    } else {
      setStatusChangePrompt(null);
      setActiveTab(
        target === 'icl'
          ? ICL_REASSESSMENT_STRATEGY
          : target === 'episode'
            ? EPISODE_CONVERSION_STRATEGY
            : DISCHARGE_STRATEGY
      );
    }
    setUpdatingId(null);
  };

  const handleDeleteImport = async (filename: string, importedAt: string, count: number) => {
    const confirmed = window.confirm(
      `Delete import "${filename}" (${count} rows)? This cannot be undone.`
    );
    if (!confirmed) return;
    const { error: err } = await deleteImport(filename, importedAt);
    if (err) setUploadError(err);
  };

  const handleDownloadImport = (filename: string, importedAt: string) => {
    const rows = records.filter(
      (r) => r.source_filename === filename && r.imported_at === importedAt
    );
    downloadEnrolmentImportXlsx(rows, filename);
  };

  const handleDownloadReportImport = async (importId: string, filename: string) => {
    const { rows, error: fetchError } = await fetchReportRowsForImport(importId);
    if (fetchError) {
      setEpicReportError(fetchError);
      return;
    }
    downloadEpicReportImportXlsx(rows ?? [], filename);
  };

  const handleDownloadCarePlanImport = async (importId: string, filename: string) => {
    const { rows, error: fetchError } = await fetchCarePlanRowsForImport(importId);
    if (fetchError) {
      setCarePlanUploadError(fetchError);
      return;
    }
    downloadCarePlanImportXlsx(rows ?? [], filename);
  };

  const handleDownloadEmarImport = async (importId: string, filename: string) => {
    const { rows, error: fetchError } = await fetchEmarRowsForImport(importId);
    if (fetchError) {
      setEmarUploadError(fetchError);
      return;
    }
    downloadEmarImportXlsx(rows ?? [], filename);
  };

  const handleDownloadServiceDataImport = async (importId: string, filename: string) => {
    const { rows, error: fetchError } = await fetchServiceDataRowsForImport(importId);
    if (fetchError) {
      setUploadError(fetchError);
      return;
    }
    downloadSsdbServiceImportXlsx(rows ?? [], filename);
  };

  const exportEpicConversionTable = (
    records: EpicConversionRecord[],
    slug: string,
    variant: EpicTableExportVariant
  ) => {
    const date = new Date().toISOString().slice(0, 10);
    downloadEpicConversionTableXlsx(records, variant, `${slug}-${date}.xlsx`, {
      validationByRecordId: epicValidationByRecordId,
    });
  };

  const handleExportSubmittedDischarges = () => {
    exportEpicConversionTable(
      dischargeSubmittedRecords,
      'submitted-discharges',
      'discharge-submitted'
    );
  };

  return (
    <>
    <div className="hc-page hc-page--split">
      {appReady && (
        <nav className="hc-strategy-tabs hc-strategy-tabs--below-title" aria-label="Epic conversion">
          <div className="hc-strategy-tabs-list">
          <button
            type="button"
            className={`hc-strategy-tab${
              isProgressTrackerTab ? ' hc-strategy-tab--active' : ''
            }`}
            onClick={() => setActiveTab(PROGRESS_TRACKER_TAB)}
          >
            {PROGRESS_TRACKER_TAB}
          </button>
          {strategyTabs.flatMap((strategy) => {
            const strategyTab = (
              <button
                key={strategy}
                type="button"
                className={`hc-strategy-tab${
                  strategy === activeTab ? ' hc-strategy-tab--active' : ''
                }`}
                onClick={() => setActiveTab(strategy)}
              >
                {strategyTabLabel(strategy)}
                <span className={strategyTabCountClassName(strategy)}>
                  {countsByStrategy.get(strategy) ?? 0}
                </span>
              </button>
            );

            const episodeValidationTab = (
              <button
                key={EPISODE_VALIDATION_TAB}
                type="button"
                className={`hc-strategy-tab${
                  isDiscrepanciesTab ? ' hc-strategy-tab--active' : ''
                }`}
                onClick={() => setActiveTab(EPISODE_VALIDATION_TAB)}
              >
                {EPISODE_VALIDATION_TAB}
                {discrepancyCount > 0 && (
                  <span className="hc-strategy-tab-count">{discrepancyCount}</span>
                )}
              </button>
            );

            const carePlanTab = (
              <button
                key={CARE_PLAN_CONVERSION_TAB}
                type="button"
                className={`hc-strategy-tab${
                  isCarePlanTab ? ' hc-strategy-tab--active' : ''
                }`}
                onClick={() => setActiveTab(CARE_PLAN_CONVERSION_TAB)}
              >
                {CARE_PLAN_CONVERSION_TAB}
                {carePlanTabCount > 0 && (
                  <span className="hc-strategy-tab-count hc-strategy-tab-count--care-plan">
                    {carePlanTabCount}
                  </span>
                )}
              </button>
            );

            const serviceDataTab = (
              <button
                key={SERVICE_DATA_CONVERSION_TAB}
                type="button"
                className={`hc-strategy-tab${
                  isServiceDataTab ? ' hc-strategy-tab--active' : ''
                }`}
                onClick={() => setActiveTab(SERVICE_DATA_CONVERSION_TAB)}
              >
                {SERVICE_DATA_CONVERSION_TAB}
              </button>
            );

            if (strategy === DISCHARGE_STRATEGY) {
              return [carePlanTab, serviceDataTab, strategyTab];
            }

            if (strategy !== EPISODE_CONVERSION_STRATEGY) {
              return [strategyTab];
            }

            return [strategyTab, episodeValidationTab];
          })}
          {!strategyTabs.includes(EPISODE_CONVERSION_STRATEGY) && (
            <button
              type="button"
              className={`hc-strategy-tab${
                isDiscrepanciesTab ? ' hc-strategy-tab--active' : ''
              }`}
              onClick={() => setActiveTab(EPISODE_VALIDATION_TAB)}
            >
              {EPISODE_VALIDATION_TAB}
              {discrepancyCount > 0 && (
                <span className="hc-strategy-tab-count">{discrepancyCount}</span>
              )}
            </button>
          )}
          {!strategyTabs.includes(DISCHARGE_STRATEGY) && (
            <>
              <button
                type="button"
                className={`hc-strategy-tab${
                  isCarePlanTab ? ' hc-strategy-tab--active' : ''
                }`}
                onClick={() => setActiveTab(CARE_PLAN_CONVERSION_TAB)}
              >
                {CARE_PLAN_CONVERSION_TAB}
                {carePlanTabCount > 0 && (
                  <span className="hc-strategy-tab-count hc-strategy-tab-count--care-plan">
                    {carePlanTabCount}
                  </span>
                )}
              </button>
              <button
                type="button"
                className={`hc-strategy-tab${
                  isServiceDataTab ? ' hc-strategy-tab--active' : ''
                }`}
                onClick={() => setActiveTab(SERVICE_DATA_CONVERSION_TAB)}
              >
                {SERVICE_DATA_CONVERSION_TAB}
              </button>
            </>
          )}
          <button
            type="button"
            className={`hc-strategy-tab${
              isUploadTab ? ' hc-strategy-tab--active' : ''
            }`}
            onClick={() => setActiveTab(UPLOAD_DATA_TAB)}
          >
            {UPLOAD_DATA_TAB}
          </button>
          </div>
          <button
            type="button"
            className={`hc-strategy-tabs-refresh${
              refreshingAll ? ' hc-strategy-tabs-refresh--spinning' : ''
            }`}
            onClick={() => void handleRefreshAll()}
            disabled={refreshingAll}
            aria-label="Refresh all data"
            title="Refresh all data"
          >
            <RefreshIcon />
          </button>
        </nav>
      )}
    </div>

    <div className="hc-epic-page-content">
      {uploadError && !isUploadTab && <p className="hc-form-error">{uploadError}</p>}
      {statusError && <p className="hc-form-error">{statusError}</p>}
      {error && <p className="hc-form-error">{error}</p>}

      {!loading && !isSpecialTab && records.length > 0 && (
      <div className="hc-toolbar">
        <label className="hc-search">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search MRN, Pathway, IC Lead"
            aria-label="Search MRN, Pathway, IC Lead"
          />
        </label>
        {!isIclTab && isEpisodeConversionTab ? (
          <>
            <div className="hc-toolbar-field">
              LOS
              <ToolbarMultiSelect
                options={losCategoryOptions}
                selected={losCategoryFilter}
                onChange={setLosCategoryFilter}
                ariaLabel="Filter by LOS"
                maxLabelsBeforeCount={2}
                formatOptionLabel={(value) => formatLosCategoryWithDays(value)}
              />
            </div>
            <div className="hc-toolbar-field">
              Latest Srv
              <ToolbarMultiSelect
                options={latestSrvOptions}
                selected={latestSrvFilter}
                onChange={setLatestSrvFilter}
                ariaLabel="Filter by latest service"
                maxLabelsBeforeCount={2}
              />
            </div>
          </>
        ) : !isIclTab ? (
          <label className="hc-toolbar-field">
            Status
            <select
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value as typeof statusFilter)
              }
            >
              <option value="all">All</option>
              <option value="unchecked">Unchecked</option>
              <option value="checked">Checked</option>
            </select>
          </label>
        ) : null}
        <div className="hc-toolbar-field">
          Pathway
          <ToolbarMultiSelect
            options={pathwayOptions}
            selected={pathwayFilter}
            onChange={setPathwayFilter}
            ariaLabel="Filter by pathway"
            maxLabelsBeforeCount={3}
          />
        </div>
        <div className="hc-toolbar-field">
          Care Path
          <ToolbarMultiSelect
            options={carePathOptions}
            selected={carePathFilter}
            onChange={setCarePathFilter}
            ariaLabel="Filter by care path"
            maxLabelsBeforeCount={2}
          />
        </div>
        <div className="hc-toolbar-field">
          IC Lead
          <ToolbarMultiSelect
            options={icLeadOptions}
            selected={icLeadFilter}
            onChange={setIcLeadFilter}
            ariaLabel="Filter by IC lead"
            maxLabelsBeforeCount={1}
          />
        </div>
        {hasActiveToolbarFilters && (
          <button
            type="button"
            className="hc-btn hc-btn-secondary hc-toolbar-clear"
            onClick={clearToolbarFilters}
          >
            Clear Filters
          </button>
        )}
      </div>
      )}

      {loading && <p className="hc-muted">Loading records…</p>}
    {!loading && isUploadTab && (
      <div className="hc-import-panels">
        <div className="hc-import-panel-header">
          <button
            type="button"
            className="hc-btn hc-btn-primary hc-import-upload-btn"
            disabled={uploadingImport}
            aria-label={uploadingImport ? 'Uploading data' : 'Import data'}
            onClick={openImportDialog}
          >
            <span className="hc-import-upload-btn-label">Import Data</span>
            <UploadDataIcon />
          </button>
        </div>
        <section className="hc-panel hc-import-panel hc-import-panel--consolidated">
          {uploadError && <p className="hc-form-error">{uploadError}</p>}
          {serviceDataError && <p className="hc-form-error">{serviceDataError}</p>}
          {uploadSuccessMessage && <p className="hc-info">{uploadSuccessMessage}</p>}
          {carePlanUploadError && <p className="hc-form-error">{carePlanUploadError}</p>}
          {carePlanError && <p className="hc-form-error">{carePlanError}</p>}
          {emarUploadError && <p className="hc-form-error">{emarUploadError}</p>}
          {emarError && <p className="hc-form-error">{emarError}</p>}
          {epicReportError && <p className="hc-form-error">{epicReportError}</p>}
          {reportError && <p className="hc-form-error">{reportError}</p>}
          <div className="hc-import-column-body">
            <div className="hc-import-table-block">
              <div className="hc-table-wrap hc-import-table-wrap">
              <table className="hc-table hc-table--grid hc-table--import">
                <thead>
                  <tr>
                    {renderImportSortableHeader(
                      'Document Type',
                      'documentType',
                      'hc-col-import-type'
                    )}
                    {renderImportSortableHeader(
                      'Uploaded Date',
                      'importedAt',
                      'hc-col-import-date'
                    )}
                    {renderImportSortableHeader('Uploaded By', 'uploadedBy', 'hc-col-import-by')}
                    <th className="hc-col-import-filename">File Name</th>
                    <th className="hc-col-import-rows"># Rows</th>
                    <th className="hc-col-import-actions">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedConsolidatedImports.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="hc-import-empty-cell">
                        <span className="hc-muted">No data uploaded yet.</span>
                      </td>
                    </tr>
                  ) : (
                    sortedConsolidatedImports.map((imp) => {
                      const uploaderName = resolveImportUploaderName(imp.kind, imp.importedBy);
                      return (
                        <tr key={imp.key}>
                          <td className="hc-col-import-type">{imp.documentType}</td>
                          <td className="hc-col-import-date">
                            <ImportUploadedDateCell importedAt={imp.importedAt} />
                          </td>
                          <td className="hc-col-import-by">{uploaderName}</td>
                          <td className="hc-col-import-filename">
                            <span className="hc-import-filename" title={imp.filename}>
                              {imp.filename}
                            </span>
                          </td>
                          <td className="hc-col-import-rows">{imp.rowCount}</td>
                          <td className="hc-col-import-actions">
                            <div className="hc-table-actions">
                              <button
                                type="button"
                                className="hc-btn hc-btn-secondary hc-btn-sm hc-btn-icon hc-btn-icon-download"
                                aria-label={`Download ${imp.filename}`}
                                onClick={() => {
                                  if (imp.kind === 'enrolment' && imp.enrolmentKey) {
                                    void handleDownloadImport(
                                      imp.enrolmentKey.filename,
                                      imp.enrolmentKey.importedAt
                                    );
                                  } else if (imp.kind === 'serviceData' && imp.serviceDataId) {
                                    void handleDownloadServiceDataImport(
                                      imp.serviceDataId,
                                      imp.filename
                                    );
                                  } else if (imp.kind === 'carePlan' && imp.carePlanId) {
                                    void handleDownloadCarePlanImport(imp.carePlanId, imp.filename);
                                  } else if (imp.kind === 'emar' && imp.emarId) {
                                    void handleDownloadEmarImport(imp.emarId, imp.filename);
                                  } else if (imp.kind === 'epicReport' && imp.reportId) {
                                    void handleDownloadReportImport(imp.reportId, imp.filename);
                                  }
                                }}
                              >
                                <DownloadDataIcon />
                              </button>
                              <button
                                type="button"
                                className="hc-btn hc-btn-danger hc-btn-sm hc-btn-icon"
                                aria-label={`Delete ${imp.filename}`}
                                onClick={() => {
                                  if (imp.kind === 'enrolment' && imp.enrolmentKey) {
                                    void handleDeleteImport(
                                      imp.enrolmentKey.filename,
                                      imp.enrolmentKey.importedAt,
                                      imp.enrolmentKey.count
                                    );
                                  } else if (imp.kind === 'serviceData' && imp.serviceDataId) {
                                    void handleDeleteServiceDataImport(
                                      imp.serviceDataId,
                                      imp.filename
                                    );
                                  } else if (imp.kind === 'carePlan' && imp.carePlanId) {
                                    void handleDeleteCarePlanImport(imp.carePlanId, imp.filename);
                                  } else if (imp.kind === 'emar' && imp.emarId) {
                                    void handleDeleteEmarImport(imp.emarId, imp.filename);
                                  } else if (imp.kind === 'epicReport' && imp.reportId) {
                                    void handleDeleteReportImport(imp.reportId, imp.filename);
                                  }
                                }}
                              >
                                <TrashIcon />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
              </div>
            </div>
          </div>
        </section>
      </div>
    )}
    {!loading && isCarePlanTab && (
      <CarePlanConversionPanel
        hasCarePlanImports={carePlanImports.length > 0}
        hasServiceDataImports={serviceDataImports.length > 0}
        serviceDataRefreshKey={serviceDataImports
          .map((imp) => `${imp.id}:${imp.imported_at}:${imp.row_count}`)
          .join('|')}
        patientLinks={carePlanPatientLinks}
        fetchSsdbServiceDateBounds={fetchSsdbServiceDateBounds}
        fetchVisitCountsByEnrollIdInDateRange={fetchVisitCountsByEnrollIdInDateRange}
        fetchPatientServicesInDateRange={fetchPatientServicesInDateRange}
        updatingRecordId={updatingId}
        onToggleCarePlanCompleted={(recordId, completed) =>
          void handleToggleCarePlanCompleted(recordId, completed)
        }
        onToggleEmarCompleted={(recordId, completed) =>
          void handleToggleEmarCompleted(recordId, completed)
        }
        onPendingConversionCountChange={setCarePlanToolbarPendingCount}
      />
    )}
    {!loading && isServiceDataTab && (
      <div className="hc-service-data-conversion" aria-label={SERVICE_DATA_CONVERSION_TAB}>
        <ServiceDataCalendar
          fetchDailyCountsForDateRange={fetchServiceDataDailyCountsWithCarePlanLink}
          fetchMonthHasServices={fetchServiceDataMonthHasServices}
          hasCarePlanImports={carePlanImports.length > 0}
          search={search}
          onSearchChange={setSearch}
          icLeadFilter={icLeadFilter}
          onIcLeadFilterChange={setIcLeadFilter}
          icLeadOptions={icLeadOptions}
          refreshKey={[
            search,
            icLeadFilter === null ? 'all' : icLeadFilter.join('\u001f'),
            ...serviceDataImports.map(
              (imp) => `${imp.id}:${imp.imported_at}:${imp.row_count}`
            ),
            ...carePlanImports.map(
              (imp) => `${imp.id}:${imp.imported_at}:${imp.row_count}`
            ),
          ].join('|')}
        />
      </div>
    )}
    {!loading && isDiscrepanciesTab && (
      <div className="hc-epic-table-stack hc-epic-table-stack--main-expanded">
        <ConversionDiscrepanciesPanel
          hasEpicReports={reportImports.length > 0}
          summary={unifiedSummary}
          reconciliationDetails={filteredReconciliationDetails}
          outcomeFilter={reconciliationOutcomeFilter}
          onOutcomeFilterChange={setReconciliationOutcomeFilter}
          onRecheck={recheckUnifiedReconciliation}
          rechecking={recheckingUnified}
        />
      </div>
    )}
    {!loading && isProgressTrackerTab && (
      <ProgressTracker
        metrics={progressMetrics}
        carePlanMetrics={carePlanProgressMetrics}
        dailyProgressSeries={dailyProgressSeries}
        unifiedImportActivity={unifiedImportActivity}
        uploaderByUserId={uploaderByUserId}
        reportUploaderByUserId={reportUploaderByUserId}
        carePlanUploaderByUserId={carePlanUploaderByUserId}
        onNavigateToStrategy={setActiveTab}
        onNavigateToCarePlan={() => setActiveTab(CARE_PLAN_CONVERSION_TAB)}
        hasServiceDataImports={serviceDataImports.length > 0}
        limitToGoLiveVisitWindow={limitProgressToGoLiveVisitWindow}
        onLimitToGoLiveVisitWindowChange={setLimitProgressToGoLiveVisitWindow}
        visitWindowFilterLoading={
          limitProgressToGoLiveVisitWindow &&
          serviceDataImports.length > 0 &&
          progressVisitCountsByEnrollId === null
        }
      />
    )}
    {!loading && !isSpecialTab && records.length > 0 && (
      <>
        {isIclTab ? (
          <div
            className={`hc-epic-table-stack${
              stackExpandMode === 'main' ? ' hc-epic-table-stack--main-expanded' : ''
            }${
              stackExpandMode === 'split' ? ' hc-epic-table-stack--split-expanded' : ''
            }`}
          >
            {renderSplitPanel(
              'ICL Decision Required',
              iclPendingRecords,
              'No rows pending ICL decision.',
              {
                variant: 'icl',
                fill: 'main',
                iclStagedDecisions: true,
                expandTarget: 'main',
                onExportXlsx: () =>
                  exportEpicConversionTable(
                    iclPendingRecords,
                    'icl-decision-required',
                    'icl-pending'
                  ),
              }
            )}
            <div className="hc-epic-split-tables">
              {renderSplitPanel(
                'Episode Conversion',
                iclConvertRecords,
                'No convert decisions yet.',
                {
                  variant: 'icl',
                  compact: true,
                  expandTarget: 'split',
                  onExportXlsx: () =>
                    exportEpicConversionTable(
                      iclConvertRecords,
                      'episode-conversion',
                      'icl-decision'
                    ),
                }
              )}
              {renderSplitPanel(
                'Discharge from Program',
                iclDischargeRecords,
                'No discharge decisions yet.',
                {
                  variant: 'icl',
                  compact: true,
                  expandTarget: 'split',
                  onExportXlsx: () =>
                    exportEpicConversionTable(
                      iclDischargeRecords,
                      'discharge-from-program-decisions',
                      'icl-decision'
                    ),
                }
              )}
            </div>
          </div>
        ) : isEpisodeConversionTab ? (
          activeRecords.length === 0 ? (
            <div className="hc-panel hc-empty">
              <p>No rows match the current filters for this strategy.</p>
            </div>
          ) : (
            <div
              className={`hc-epic-table-stack${
                stackExpandMode === 'main' ? ' hc-epic-table-stack--main-expanded' : ''
              }${
                stackExpandMode === 'split' ? ' hc-epic-table-stack--split-expanded' : ''
              }`}
            >
              {renderSplitPanel(
                'Pending Conversion',
                episodeConversionPendingRecords,
                'No pending conversions.',
                {
                  variant: 'status',
                  fill: 'main',
                  statusInput: 'radio',
                  showChangeStatus: true,
                  expandTarget: 'main',
                  onExportXlsx: () =>
                    exportEpicConversionTable(
                      episodeConversionPendingRecords,
                      'pending-conversion',
                      'status-pending'
                    ),
                }
              )}
              {renderSplitPanel(
                'Episode Conversion Complete',
                filteredEpisodeConversionCompletedRecords,
                completionValidationFilter === 'all'
                  ? 'No completed conversions yet.'
                  : 'No rows match the selected validation filter.',
                {
                  variant: 'status',
                  compact: true,
                  compactMode: 'completion',
                  expandTarget: 'split',
                  validationCounts: episodeConversionValidationCounts,
                  validationFilter: completionValidationFilter,
                  onValidationFilterChange: setCompletionValidationFilter,
                  onExportXlsx: () =>
                    exportEpicConversionTable(
                      filteredEpisodeConversionCompletedRecords,
                      'episode-conversion-complete',
                      'status-completion'
                    ),
                }
              )}
            </div>
          )
        ) : isDischargeTab ? (
          activeRecords.length === 0 ? (
            <div className="hc-panel hc-empty">
              <p>No rows match the current filters for this strategy.</p>
            </div>
          ) : (
            <div
              className={`hc-epic-table-stack${
                stackExpandMode === 'main' ? ' hc-epic-table-stack--main-expanded' : ''
              }${
                stackExpandMode === 'split' ? ' hc-epic-table-stack--split-expanded' : ''
              }`}
            >
              {renderSplitPanel(
                'Discharge from Program',
                dischargePendingRecords,
                'No pending discharges.',
                {
                  variant: 'discharge',
                  fill: 'main',
                  expandTarget: 'main',
                  onExportXlsx: () =>
                    exportEpicConversionTable(
                      dischargePendingRecords,
                      'pending-discharges',
                      'discharge-pending'
                    ),
                }
              )}
              {renderSplitPanel(
                'Submitted Discharges',
                dischargeSubmittedRecords,
                'No submitted discharges yet.',
                {
                  variant: 'discharge',
                  compact: true,
                  compactMode: 'discharge-submitted',
                  expandTarget: 'split',
                  onExportXlsx: handleExportSubmittedDischarges,
                }
              )}
            </div>
          )
        ) : activeRecords.length === 0 ? (
          <div className="hc-panel hc-empty">
            <p>No rows match the current filters for this strategy.</p>
          </div>
        ) : (
          renderRecordsTable(activeRecords, { variant: 'status', fill: true })
        )}
      </>
    )}
    </div>
    <ConsolidatedImportUploadDialog
      open={importDialogOpen}
      phase={importDialogPhase}
      files={importDialogFiles}
      error={importDialogError}
      successMessage={importDialogSuccessMessage}
      onClose={closeImportDialog}
      onFileChange={handleImportDialogFileChange}
      onSubmit={() => void handleImportDialogSubmit()}
      onShowEnrolmentHowto={() => setSsdbHowtoOpen(true)}
    />
    <SsdbEnrolmentHowtoModal open={ssdbHowtoOpen} onClose={() => setSsdbHowtoOpen(false)} />
    {statusChangePrompt && (
      <div
        className="hc-modal-backdrop"
        role="presentation"
        onClick={() => setStatusChangePrompt(null)}
      >
        <div
          className="hc-modal hc-modal--discharge-status"
          role="dialog"
          aria-modal="true"
          aria-labelledby="epic-status-change-title"
          onClick={(e) => e.stopPropagation()}
        >
          <header className="hc-modal-header">
            <h2 id="epic-status-change-title">Change status</h2>
            <button
              type="button"
              className="hc-btn hc-btn-ghost hc-modal-close"
              aria-label="Close"
              onClick={() => setStatusChangePrompt(null)}
            >
              ×
            </button>
          </header>
          <p className="hc-discharge-status-change-lead">
            MRN {statusChangePrompt.record.mrn} — choose where to move this record:
          </p>
          <div className="hc-discharge-status-change-actions">
            <button
              type="button"
              className="hc-btn hc-btn-primary"
              disabled={updatingId === statusChangePrompt.record.id}
              onClick={() => void confirmStatusChange('icl')}
            >
              ICL Decision Required
            </button>
            {statusChangePrompt.flow === 'discharge' ? (
              <button
                type="button"
                className="hc-btn hc-btn-primary"
                disabled={updatingId === statusChangePrompt.record.id}
                onClick={() => void confirmStatusChange('episode')}
              >
                Episode Conversion
              </button>
            ) : (
              <button
                type="button"
                className="hc-btn hc-btn-primary"
                disabled={updatingId === statusChangePrompt.record.id}
                onClick={() => void confirmStatusChange('discharge')}
              >
                {strategyTabLabel(DISCHARGE_STRATEGY)}
              </button>
            )}
            <button
              type="button"
              className="hc-btn hc-btn-ghost"
              disabled={updatingId === statusChangePrompt.record.id}
              onClick={() => setStatusChangePrompt(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );

  function renderSplitPanel(
    title: string,
    groupRecords: EpicConversionRecord[],
    emptyMessage: string,
    options: {
      variant: 'icl' | 'status' | 'discharge';
      fill?: boolean | 'main';
      hideHeader?: boolean;
      compact?: boolean;
      compactMode?: 'icl-decision' | 'completion' | 'discharge-submitted';
      statusInput?: 'checkbox' | 'radio';
      showChangeStatus?: boolean;
      iclStagedDecisions?: boolean;
      expandTarget?: 'main' | 'split';
      validationCounts?: { pending: number; discrepancy: number; validated: number };
      validationFilter?: CompletionValidationFilter;
      onValidationFilterChange?: (filter: CompletionValidationFilter) => void;
      onExportXlsx?: () => void;
    } = {
      variant: 'status',
    }
  ) {
    const isMainPanel = options.fill === 'main';
    return (
      <section
        className={`hc-epic-split-panel${isMainPanel ? ' hc-epic-split-panel--main' : ''}`}
      >
        <h3 className="hc-epic-split-panel-title">
          <span className="hc-epic-split-panel-title-main">
            {title}
            {options.validationCounts ? (
              <span className="hc-epic-split-panel-counts">
                {(
                  [
                    ['pending', 'Pending validation'],
                    ['discrepancy', 'Discrepancy detected'],
                    ['validated', 'Validated'],
                  ] as const
                ).map(([kind, label]) => {
                  const active = options.validationFilter === kind;
                  const count = options.validationCounts![kind];
                  const className = `hc-epic-split-panel-count hc-epic-split-panel-count--${kind}${
                    active ? ' hc-epic-split-panel-count--active' : ''
                  }`;

                  if (options.onValidationFilterChange) {
                    return (
                      <button
                        key={kind}
                        type="button"
                        className={className}
                        title={label}
                        aria-pressed={active}
                        aria-label={`${count} ${label.toLowerCase()}`}
                        onClick={() =>
                          options.onValidationFilterChange!(
                            active ? 'all' : kind
                          )
                        }
                      >
                        {count}
                      </button>
                    );
                  }

                  return (
                    <span
                      key={kind}
                      className={className}
                      title={label}
                      aria-label={`${count} ${label.toLowerCase()}`}
                    >
                      {count}
                    </span>
                  );
                })}
              </span>
            ) : (
              <span className="hc-epic-split-panel-count">{groupRecords.length}</span>
            )}
          </span>
          {(options.onExportXlsx || options.expandTarget) && (
            <span className="hc-epic-split-panel-title-actions">
              {options.onExportXlsx && (
                <TableExportButton
                  disabled={groupRecords.length === 0}
                  ariaLabel={`Export ${title} as Excel`}
                  onClick={options.onExportXlsx}
                />
              )}
              {options.expandTarget && (
                <button
                  type="button"
                  className={[
                    'hc-btn',
                    'hc-epic-split-panel-expand',
                    stackExpandMode === options.expandTarget
                      ? 'hc-epic-split-panel-expand--collapse'
                      : 'hc-epic-split-panel-expand--expand',
                  ].join(' ')}
                  aria-label={
                    stackExpandMode === options.expandTarget
                      ? 'Contract panel'
                      : 'Expand panel'
                  }
                  onClick={() => toggleStackExpand(options.expandTarget!)}
                />
              )}
            </span>
          )}
        </h3>
        {groupRecords.length === 0 ? (
          <p className="hc-muted hc-epic-split-panel-empty">{emptyMessage}</p>
        ) : options.compact ? (
          renderCompactRecordsTable(groupRecords, options.compactMode ?? 'icl-decision')
        ) : (
          renderRecordsTable(groupRecords, options)
        )}
        {options.iclStagedDecisions && stagedIclDecisionCount > 0 && (
          <footer className="hc-epic-split-panel-footer">
            <span className="hc-epic-split-panel-footer-summary">
              {stagedConvertCount} conversion{stagedConvertCount === 1 ? '' : 's'},{' '}
              {stagedDischargeCount} discharge{stagedDischargeCount === 1 ? '' : 's'}
            </span>
            <button
              type="button"
              className="hc-btn hc-btn-primary hc-btn-sm"
              disabled={submittingIclDecisions}
              onClick={() => void handleSubmitStagedIclDecisions()}
            >
              Submit {stagedIclDecisionCount} Decisions
            </button>
          </footer>
        )}
      </section>
    );
  }

  function renderCompactRecordsTable(
    groupRecords: EpicConversionRecord[],
    mode: 'icl-decision' | 'completion' | 'discharge-submitted' = 'icl-decision'
  ) {
    const isCompletion = mode === 'completion';
    const isDischargeSubmitted = mode === 'discharge-submitted';
    const showEpicColumn = isCompletion && showEpicSnapshotColumn;
    return (
      <div className="hc-table-wrap hc-table-wrap--wide">
        <table
          className={`hc-table hc-table--compact hc-table--epic-compact${
            isDischargeSubmitted ? ' hc-table--epic-compact-discharge-submitted' : ''
          }${showEpicColumn ? ' hc-table--epic-compact-completion' : ''}`}
        >
          <colgroup>
            <col className="hc-epic-compact-col-primary" />
            {showEpicColumn && <col className="hc-epic-compact-col-epic" />}
            {isDischargeSubmitted ? (
              <>
                <col className="hc-epic-compact-col-discharge-details" />
                <col className="hc-epic-compact-col-submitted" />
              </>
            ) : (
              <col className="hc-epic-compact-col-decision" />
            )}
            <col className="hc-epic-compact-col-undo" />
          </colgroup>
          {isCompletion && (
            <thead>
              <tr>
                <th scope="col">VHA SSDB Data</th>
                {showEpicColumn && <th scope="col">Epic Episode Data</th>}
                <th scope="col">Conversion Status</th>
                <th scope="col" aria-label="Actions" />
              </tr>
            </thead>
          )}
          <tbody>
            {groupRecords.map((r) => (
              <tr key={r.id}>
                <td className="hc-epic-compact-primary">
                  <div className="hc-epic-compact-line1">
                    <span className="hc-epic-compact-mrn">
                      MRN {highlightMatch(r.mrn, search)}
                    </span>
                    {r.los_category && (
                      <span className="hc-badge hc-badge--draft hc-epic-compact-badge">
                        LOS: {formatLosCategoryWithDays(r.los_category)}
                      </span>
                    )}
                    {r.latest_srv && (
                      <span className="hc-badge hc-badge--draft hc-epic-compact-badge">
                        LVD: {r.latest_srv}
                      </span>
                    )}
                  </div>
                  <div className="hc-epic-compact-line2">
                    {highlightMatch(formatPathwayWithCarePath(r), search)}
                    {' | '}
                    {highlightMatch(r.ic_lead, search)}
                  </div>
                </td>
                {showEpicColumn && (
                  <td className="hc-epic-compact-epic">
                    {(() => {
                      const validation = epicValidationByRecordId.get(r.id);
                      const epicSnapshot = epicSnapshotByRecordId.get(r.id);
                      if (
                        !epicSnapshot ||
                        (validation?.status !== 'validated' &&
                          validation?.status !== 'discrepancy')
                      ) {
                        return null;
                      }
                      const icLead = epicSnapshot.icLead ?? '—';
                      return (
                        <>
                          <div className="hc-epic-compact-line1">
                            <span className="hc-epic-compact-mrn">
                              MRN {highlightMatch(epicSnapshot.mrn, search)}
                            </span>
                          </div>
                          <div className="hc-epic-compact-line2">
                            {highlightMatch(epicSnapshot.pathwayDisplay, search)}
                            {' | '}
                            {highlightMatch(icLead, search)}
                          </div>
                        </>
                      );
                    })()}
                  </td>
                )}
                {isDischargeSubmitted ? (
                  <>
                    <td className="hc-epic-compact-discharge-details">
                      <div className="hc-epic-compact-decision-user">
                        Prog DC Date: {formatDate(r.discharge_date)}
                      </div>
                      <div className="hc-epic-compact-decision-time">
                        DC Reason: {r.discharge_reason ?? '—'}
                      </div>
                    </td>
                    <td className="hc-epic-compact-decision">
                      <div className="hc-epic-compact-decision-user">
                        submitted by {emailToUsername(r.discharged_by)}
                      </div>
                      <div className="hc-epic-compact-decision-time">
                        {formatDecisionStampAt(r.discharged_at ?? r.updated_at)}
                      </div>
                    </td>
                  </>
                ) : (
                  <td className="hc-epic-compact-decision">
                    {isCompletion && r.completed_at ? (
                      <>
                        <div className="hc-epic-compact-decision-user">
                          {formatDecisionStampAt(r.completed_at)} by{' '}
                          {emailToUsername(r.completed_by)}
                        </div>
                        {(() => {
                          const { text, className } = formatEpicValidationStatus(
                            r.id,
                            epicValidationByRecordId
                          );
                          return (
                            <div className={`hc-epic-compact-decision-time ${className}`}>
                              {text}
                            </div>
                          );
                        })()}
                      </>
                    ) : !isCompletion && r.icl_decision_at ? (
                      <>
                        <div className="hc-epic-compact-decision-user">
                          {emailToUsername(r.icl_decision_by)}
                        </div>
                        <div className="hc-epic-compact-decision-time">
                          {formatDecisionStampAt(r.icl_decision_at)}
                        </div>
                      </>
                    ) : null}
                  </td>
                )}
                <td className="hc-epic-compact-undo-cell">
                  <div className="hc-epic-compact-undo-inner">
                    {isCompletion && validatedRecordIds.has(r.id) ? (
                      <span
                        className="hc-epic-compact-validated"
                        aria-label="Validated against Epic conversion report"
                        title="Validated against Epic conversion report"
                      >
                        ✓
                      </span>
                    ) : isCompletion &&
                      getRecordValidationKind(r.id, epicValidationByRecordId) !==
                        'pending' ? null : (
                      <button
                        type="button"
                        className="hc-epic-compact-undo"
                        disabled={updatingId === r.id}
                        aria-label={
                          isCompletion
                            ? 'Undo completion and mark as pending'
                            : isDischargeSubmitted
                              ? 'Undo discharge submission and return to pending'
                              : 'Undo decision and return to ICL Decision Required'
                        }
                        title={
                          isCompletion
                            ? 'Mark as pending'
                            : isDischargeSubmitted
                              ? 'Return to pending discharge'
                              : 'Return to ICL Decision Required'
                        }
                        onClick={() =>
                          void (isCompletion
                            ? handleToggleCompleted(r, false)
                            : isDischargeSubmitted
                              ? handleUndoDischarge(r)
                              : handleIclDecisionChange(r, 'pending'))
                        }
                      >
                        ×
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  function renderRecordsTable(
    groupRecords: EpicConversionRecord[],
    options: {
      variant: 'icl' | 'status' | 'discharge';
      fill?: boolean | 'main';
      hideHeader?: boolean;
      iclStagedDecisions?: boolean;
      statusInput?: 'checkbox' | 'radio';
      showChangeStatus?: boolean;
    }
  ) {
    const showIclDecision = options.variant === 'icl';
    const showDischargeDetails = options.variant === 'discharge';
    const showIclStagedDecisions = options.iclStagedDecisions === true && showIclDecision;
    const useStatusRadio = options.statusInput === 'radio';
    const showChangeStatus = options.showChangeStatus === true && useStatusRadio;
    const hideHeader = options.hideHeader === true;
    const displayRecords = epicTableSort
      ? sortEpicRecords(groupRecords, epicTableSort)
      : groupRecords;

    const renderSortableHeader = (label: string, key: EpicTableSortKey, className: string) => {
      const active = epicTableSort?.key === key;
      const direction = active ? epicTableSort.direction : null;
      return (
        <th className={className}>
          <button
            type="button"
            className={`hc-table-sort${direction ? ` hc-table-sort--${direction}` : ''}`}
            aria-sort={
              direction ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'
            }
            onClick={() => toggleEpicTableSort(key)}
          >
            {label}
            <span className="hc-table-sort-indicator" aria-hidden />
          </button>
        </th>
      );
    };
    const wrapClass = [
      'hc-table-wrap',
      'hc-table-wrap--wide',
      options.fill === true
        ? 'hc-table-wrap--fill'
        : options.fill === 'main'
          ? 'hc-table-wrap--fill-main'
          : '',
      showIclStagedDecisions ? 'hc-table-wrap--icl-staged' : '',
      showDischargeDetails ? 'hc-table-wrap--discharge' : '',
    ]
      .filter(Boolean)
      .join(' ');

    return (
      <div className={wrapClass}>
        <table className="hc-table hc-table--grid hc-table--compact">
          {!hideHeader && (
          <thead>
            <tr>
              <th className="hc-col-mrn">MRN</th>
              {renderSortableHeader('Pathway', 'pathway', 'hc-col-pathway')}
              {renderSortableHeader('IC Lead', 'ic_lead', 'hc-col-ic-lead')}
              {!showDischargeDetails &&
                renderSortableHeader('Hosp DC', 'hosp_dc', 'hc-col-hosp-dc')}
              {renderSortableHeader('LOS', 'los', 'hc-col-los')}
              {renderSortableHeader('Latest Srv', 'latest_srv', 'hc-col-latest-srv')}
              <th
                className={`hc-col-status${
                  showIclDecision ? ' hc-col-status--icl' : ''
                }${showDischargeDetails ? ' hc-col-status--discharge' : ''}`}
              >
                {showIclDecision
                  ? 'ICL Decision'
                  : showDischargeDetails
                    ? 'Discharge Details'
                    : 'Status'}
              </th>
            </tr>
          </thead>
          )}
          <tbody>
            {displayRecords.map((r) => {
              const pddDate = computePddDate(r);
              const dischargeDateOther = r.discharge_date_source === 'other';
              const dischargeSubmitReady = isDischargeSubmitReady(r, pddDate);
              const canSubmitDischarge = dischargeSubmitReady && r.status !== 'discharged';
              return (
              <tr key={r.id}>
                <td className="hc-col-mrn">{highlightMatch(r.mrn, search)}</td>
                <td className="hc-cell-wrap hc-col-pathway">
                  <span className="hc-pathway-primary">
                    {highlightMatch(r.pathway, search)}
                  </span>
                  {r.care_path && (
                    <span className="hc-pathway-secondary">
                      {highlightMatch(r.care_path, search)}
                    </span>
                  )}
                </td>
                <td className="hc-col-ic-lead">{highlightMatch(r.ic_lead, search)}</td>
                {!showDischargeDetails && (
                  <td className="hc-col-hosp-dc">
                    {formatDate(r.hosp_dc_date ?? r.registration_date)}
                  </td>
                )}
                <td className="hc-los-cell hc-col-los">
                  {r.los_category && (
                    <span className="hc-badge hc-badge--draft hc-los-badge">
                      {formatLosCategoryWithDays(r.los_category)}
                    </span>
                  )}
                  {r.los != null && (
                    <span className="hc-los-detail">{r.los} days</span>
                  )}
                  {r.los_category == null && r.los == null && '—'}
                </td>
                <td className="hc-srv-cell hc-col-latest-srv">
                  <span className="hc-badge hc-badge--draft hc-srv-badge">
                    {r.latest_srv ?? '—'}
                  </span>
                  <span className="hc-srv-detail">{formatSrvDetail(r)}</span>
                </td>
                <td
                  className={`hc-col-status${
                    showIclDecision ? ' hc-col-status--icl' : ''
                  }${showDischargeDetails ? ' hc-col-status--discharge' : ''}`}
                >
                  {showDischargeDetails ? (
                    <div className="hc-discharge-cell">
                      <div className="hc-discharge-details">
                      <div className="hc-discharge-field-row">
                        <span
                          id={`epic-discharge-date-label-${r.id}`}
                          className="hc-discharge-field-label"
                        >
                          Prog DC Date
                        </span>
                        <div
                          className={`hc-discharge-date-radios${
                            dischargeDateOther ? ' hc-discharge-date-radios--other' : ''
                          }`}
                          role="radiogroup"
                          aria-labelledby={`epic-discharge-date-label-${r.id}`}
                        >
                        <label className="hc-status-radio-choice">
                          <input
                            type="radio"
                            name={`epic-discharge-date-${r.id}`}
                            className="hc-status-radio"
                            checked={r.discharge_date_source === 'lvd'}
                            disabled={updatingId === r.id || !r.lvd}
                            onChange={() => void handleDischargeDateSourceChange(r, 'lvd')}
                          />
                          <span>
                            {dischargeDateOther || !r.lvd
                              ? 'LVD'
                              : `LVD (${formatDate(r.lvd)})`}
                          </span>
                        </label>
                        <label className="hc-status-radio-choice">
                          <input
                            type="radio"
                            name={`epic-discharge-date-${r.id}`}
                            className="hc-status-radio"
                            checked={r.discharge_date_source === 'pdd'}
                            disabled={updatingId === r.id || !pddDate}
                            onChange={() => void handleDischargeDateSourceChange(r, 'pdd')}
                          />
                          <span>
                            {dischargeDateOther || !pddDate
                              ? 'PDD'
                              : `PDD (${formatDate(pddDate)})`}
                          </span>
                        </label>
                        <label className="hc-status-radio-choice">
                          <input
                            type="radio"
                            name={`epic-discharge-date-${r.id}`}
                            className="hc-status-radio"
                            checked={dischargeDateOther}
                            disabled={updatingId === r.id}
                            onChange={() => void handleDischargeDateSourceChange(r, 'other')}
                          />
                          <span>Other</span>
                        </label>
                        {dischargeDateOther && (
                          <span
                            className={`hc-discharge-date-input-wrap${
                              !r.discharge_date
                                ? ' hc-discharge-date-input-wrap--empty'
                                : ' hc-discharge-date-input-wrap--chosen'
                            }`}
                          >
                            <input
                              type="date"
                              className="hc-discharge-date-input"
                              value={r.discharge_date ?? ''}
                              disabled={updatingId === r.id}
                              aria-label="Select Prog DC Date"
                              onClick={(e) => {
                                const input = e.currentTarget;
                                if (input.disabled || typeof input.showPicker !== 'function') return;
                                try {
                                  void input.showPicker();
                                } catch {
                                  /* picker already open or unavailable */
                                }
                              }}
                              onChange={(e) => void handleDischargeCustomDateChange(r, e.target.value)}
                            />
                            <span className="hc-discharge-date-input-placeholder" aria-hidden="true">
                              Select Prog DC Date...
                            </span>
                          </span>
                        )}
                        </div>
                      </div>
                      <div className="hc-discharge-field-row">
                        <span
                          id={`epic-discharge-reason-label-${r.id}`}
                          className="hc-discharge-field-label"
                        >
                          DC Reason
                        </span>
                        <select
                          className={`hc-icl-decision-select${
                            r.discharge_reason ? ' hc-icl-decision-select--chosen' : ''
                          }`}
                          value={r.discharge_reason ?? ''}
                          disabled={updatingId === r.id}
                          aria-labelledby={`epic-discharge-reason-label-${r.id}`}
                          onChange={(e) => void handleDischargeReasonChange(r, e.target.value)}
                        >
                          <option value="">Discharge Reason</option>
                          {DISCHARGE_REASONS.map((reason) => (
                            <option key={reason} value={reason}>
                              {reason}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                      <div className="hc-discharge-action">
                        <button
                          type="button"
                          className="hc-btn hc-discharge-action-btn hc-discharge-change-status-btn"
                          disabled={updatingId === r.id}
                          aria-label="Change status"
                          onClick={() => setStatusChangePrompt({ record: r, flow: 'discharge' })}
                        >
                          Change Status
                        </button>
                        <button
                          type="button"
                          className={`hc-btn hc-discharge-action-btn${
                            canSubmitDischarge ? ' hc-btn-primary' : ''
                          }`}
                          disabled={!canSubmitDischarge || updatingId === r.id}
                          aria-label="Submit DC"
                          onClick={() => void handleSubmitDischarge(r)}
                        >
                          Submit DC
                        </button>
                      </div>
                    </div>
                  ) : showIclDecision ? (
                    <div className="hc-icl-decision-choices">
                      <label className="hc-icl-decision-choice">
                        <input
                          type="checkbox"
                          className="hc-status-checkbox hc-icl-decision-checkbox hc-icl-decision-checkbox--convert"
                          checked={stagedIclDecisions.get(r.id) === 'convert'}
                          disabled={submittingIclDecisions || updatingId === r.id}
                          onChange={(e) =>
                            setStagedIclDecision(r.id, 'convert', e.target.checked)
                          }
                        />
                        <span>Convert</span>
                      </label>
                      <label className="hc-icl-decision-choice">
                        <input
                          type="checkbox"
                          className="hc-status-checkbox hc-icl-decision-checkbox hc-icl-decision-checkbox--discharge"
                          checked={stagedIclDecisions.get(r.id) === 'discharge'}
                          disabled={submittingIclDecisions || updatingId === r.id}
                          onChange={(e) =>
                            setStagedIclDecision(r.id, 'discharge', e.target.checked)
                          }
                        />
                        <span>Discharge</span>
                      </label>
                    </div>
                  ) : useStatusRadio ? (
                    <div className="hc-status-conversion">
                      <div
                        className="hc-status-radios"
                        role="radiogroup"
                        aria-label="Conversion status"
                      >
                        <label className="hc-status-radio-choice">
                          <input
                            type="radio"
                            name={`epic-status-${r.id}`}
                            className="hc-status-radio"
                            checked={r.completed_at == null}
                            disabled={updatingId === r.id}
                            onChange={() => {
                              if (r.completed_at) void handleToggleCompleted(r, false);
                            }}
                          />
                          <span>Pending</span>
                        </label>
                        <label className="hc-status-radio-choice">
                          <input
                            type="radio"
                            name={`epic-status-${r.id}`}
                            className="hc-status-radio"
                            checked={r.completed_at != null}
                            disabled={updatingId === r.id}
                            onChange={() => {
                              if (!r.completed_at) void handleToggleCompleted(r, true);
                            }}
                          />
                          <span>Converted</span>
                        </label>
                      </div>
                      {showChangeStatus && (
                        <button
                          type="button"
                          className="hc-status-reclassify"
                          disabled={updatingId === r.id}
                          aria-label="Change status"
                          onClick={() => setStatusChangePrompt({ record: r, flow: 'episode' })}
                        >
                          Change Status
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="hc-status-row">
                      <div className="hc-status-row-checkbox">
                        <label className="hc-status-toggle">
                          <input
                            type="checkbox"
                            className="hc-status-checkbox"
                            checked={r.completed_at != null}
                            disabled={updatingId === r.id}
                            onChange={(e) => void handleToggleCompleted(r, e.target.checked)}
                          />
                        </label>
                      </div>
                      <span className="hc-status-label">
                        {r.completed_at ? 'Converted' : 'Pending'}
                      </span>
                      {r.completed_at && (
                        <span className="hc-status-stamp">
                          {r.completed_by ?? 'unknown'}
                          <br />
                          {formatCompletedAt(r.completed_at)}
                        </span>
                      )}
                    </div>
                  )}
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }
}
