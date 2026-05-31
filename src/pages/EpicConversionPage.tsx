import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { parseEpicConversionXlsxBuffer } from '../epicConversion/ingest/parseEpicConversionXlsx';
import { useEpicConversionRecords } from '../epicConversion/hooks/useEpicConversionRecords';
import { useEpicConversionReports } from '../epicConversion/hooks/useEpicConversionReports';
import { ProgressTracker } from '../epicConversion/components/ProgressTracker';
import { computeImportActivity } from '../epicConversion/progress/computeImportActivity';
import { formatStrategyBreakdown } from '../epicConversion/progress/computeImportActivity';
import { computeDailyProgressSeries } from '../epicConversion/progress/computeDailyProgressSeries';
import { computeProgressMetrics } from '../epicConversion/progress/computeProgressMetrics';
import {
  DISCHARGE_STRATEGY,
  EPISODE_CONVERSION_STRATEGY,
  ICL_REASSESSMENT_STRATEGY,
  NO_STRATEGY_LABEL,
  recordBelongsToStrategyTab,
  recordBelongsToStrategyTabBadge,
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

function formatImportUploadMeta(uploaderName: string, importedAt: string): string {
  const d = new Date(importedAt);
  if (Number.isNaN(d.getTime())) {
    return `Uploaded by ${uploaderName} on ${importedAt}`;
  }
  const date = d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const hours = d.getHours().toString().padStart(2, '0');
  const minutes = d.getMinutes().toString().padStart(2, '0');
  return `Uploaded by ${uploaderName} on ${date} at ${hours}:${minutes}`;
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
const UPLOAD_DATA_TAB = 'Upload Data';

function formatPathwayWithCarePath(r: EpicConversionRecord): string {
  if (r.pathway && r.care_path) return `${r.pathway} (${r.care_path})`;
  return r.pathway ?? r.care_path ?? '—';
}

type EpicTableSortKey = 'pathway' | 'ic_lead' | 'hosp_dc' | 'los' | 'latest_srv';
type SortDirection = 'asc' | 'desc';

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
  const { records, loading, error, insertRows, setCompletion, setDischargeDetails, submitDischarge, undoDischarge, setIclDecision, deleteImport } =
    useEpicConversionRecords();
  const { user, profile } = useAuth();
  const convertedRecords = useMemo(
    () => records.filter((r) => r.completed_at != null),
    [records]
  );
  const {
    reportImports,
    reportError,
    latestSummary,
    reconciliationDetails,
    detailsImportId,
    uploadReport,
    loadReconciliationDetails,
    deleteReport,
  } = useEpicConversionReports(convertedRecords);
  const progressMetrics = useMemo(() => computeProgressMetrics(records), [records]);
  const dailyProgressSeries = useMemo(() => computeDailyProgressSeries(records), [records]);
  const importActivity = useMemo(() => computeImportActivity(records), [records]);
  const enrolmentFileRef = useRef<HTMLInputElement>(null);
  const epicReportsFileRef = useRef<HTMLInputElement>(null);
  const [uploadingEnrolment, setUploadingEnrolment] = useState(false);
  const [uploadingEpicReport, setUploadingEpicReport] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccessMessage, setUploadSuccessMessage] = useState<string | null>(null);
  const [epicReportError, setEpicReportError] = useState<string | null>(null);
  const [epicReportSuccessMessage, setEpicReportSuccessMessage] = useState<string | null>(null);
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
  const [stackExpandMode, setStackExpandMode] = useState<'none' | 'main' | 'split'>('none');
  const [epicTableSort, setEpicTableSort] = useState<{
    key: EpicTableSortKey;
    direction: SortDirection;
  } | null>(null);

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
  const isSpecialTab = isUploadTab || isProgressTrackerTab;

  useEffect(() => {
    if (!isProgressTrackerTab || !latestSummary) return;
    void loadReconciliationDetails(latestSummary.importId);
  }, [isProgressTrackerTab, latestSummary, loadReconciliationDetails]);

  useEffect(() => {
    if (loading) return;
    if (strategyTabs.length === 0) {
      if (activeTab !== UPLOAD_DATA_TAB) setActiveTab(UPLOAD_DATA_TAB);
      return;
    }
    if (activeTab === UPLOAD_DATA_TAB || activeTab === PROGRESS_TRACKER_TAB) return;
    if (!activeTab || !strategyTabs.includes(activeTab)) {
      setActiveTab(PROGRESS_TRACKER_TAB);
    }
  }, [strategyTabs, activeTab, loading]);

  const isIclTab = activeTab === ICL_REASSESSMENT_STRATEGY;
  const isEpisodeConversionTab = activeTab === EPISODE_CONVERSION_STRATEGY;
  const isDischargeTab = activeTab === DISCHARGE_STRATEGY;

  useEffect(() => {
    setStackExpandMode('none');
  }, [activeTab]);

  const toggleEpicTableSort = (key: EpicTableSortKey) => {
    setEpicTableSort((prev) => {
      if (prev?.key === key) {
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
    return filtered.filter(
      (r) =>
        r.episode_conversion_strategy === ICL_REASSESSMENT_STRATEGY && !r.icl_decision
    );
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

  const handleEnrolmentUpload = async (file: File) => {
    setUploadingEnrolment(true);
    setUploadError(null);
    setUploadSuccessMessage(null);
    try {
      const buf = await file.arrayBuffer();
      const parsed = parseEpicConversionXlsxBuffer(buf, file.name);
      if (parsed.errors.length) {
        setUploadError(parsed.errors.slice(0, 4).join('; '));
        setUploadingEnrolment(false);
        return;
      }

      const result = await insertRows(parsed.rows, user?.id ?? null);
      if (result.error) {
        setUploadError(result.error);
      } else {
        const breakdown = formatStrategyBreakdown(result.strategyBreakdown);
        if (result.inserted > 0) {
          setUploadSuccessMessage(
            `Inserted ${result.inserted} net-new record${result.inserted === 1 ? '' : 's'} (${breakdown}).` +
              (result.skippedDuplicates > 0
                ? ` Skipped ${result.skippedDuplicates} duplicate${result.skippedDuplicates === 1 ? '' : 's'}.`
                : '')
          );
        } else if (result.skippedDuplicates > 0) {
          setUploadSuccessMessage(
            `No net-new records added. Skipped ${result.skippedDuplicates} duplicate${result.skippedDuplicates === 1 ? '' : 's'}.`
          );
        } else {
          setUploadSuccessMessage('Upload completed with no rows to insert.');
        }
        if (parsed.skipped > 0) {
          setUploadSuccessMessage(
            (prev) =>
              `${prev ?? ''} ${parsed.skipped} row${parsed.skipped === 1 ? '' : 's'} skipped during parse.`.trim()
          );
        }
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
    }
    setUploadingEnrolment(false);
  };

  const handleEpicReportsUpload = async (file: File) => {
    setUploadingEpicReport(true);
    setEpicReportError(null);
    setEpicReportSuccessMessage(null);
    const result = await uploadReport(file, user?.id ?? null);
    if (result.error) {
      setEpicReportError(result.error);
    } else if (result.summary) {
      setEpicReportSuccessMessage(
        `Uploaded ${result.rowCount} row${result.rowCount === 1 ? '' : 's'}. ` +
          `${result.summary.perfect} perfect, ${result.summary.incorrect} incorrect, ${result.summary.unmatched} unmatched.`
      );
    }
    setUploadingEpicReport(false);
  };

  const handleDeleteReportImport = async (importId: string, filename: string) => {
    if (!window.confirm(`Delete Epic report "${filename}" and its reconciliation results?`)) return;
    const { error: err } = await deleteReport(importId);
    if (err) setEpicReportError(err);
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

  return (
    <>
    <div className="hc-page hc-page--split">
      <input
        ref={enrolmentFileRef}
        type="file"
        accept=".xlsx,.xls"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleEnrolmentUpload(f);
          e.target.value = '';
        }}
      />
      <input
        ref={epicReportsFileRef}
        type="file"
        accept=".xlsx,.xls"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleEpicReportsUpload(f);
          e.target.value = '';
        }}
      />

      {!loading && (
        <nav className="hc-strategy-tabs hc-strategy-tabs--below-title" aria-label="Epic conversion">
          <button
            type="button"
            className={`hc-strategy-tab${
              isProgressTrackerTab ? ' hc-strategy-tab--active' : ''
            }`}
            onClick={() => setActiveTab(PROGRESS_TRACKER_TAB)}
          >
            {PROGRESS_TRACKER_TAB}
          </button>
          {strategyTabs.map((strategy) => (
            <button
              key={strategy}
              type="button"
              className={`hc-strategy-tab${
                strategy === activeTab ? ' hc-strategy-tab--active' : ''
              }`}
              onClick={() => setActiveTab(strategy)}
            >
              {strategyTabLabel(strategy)}
              <span className="hc-strategy-tab-count">
                {countsByStrategy.get(strategy) ?? 0}
              </span>
            </button>
          ))}
          <button
            type="button"
            className={`hc-strategy-tab${
              isUploadTab ? ' hc-strategy-tab--active' : ''
            }`}
            onClick={() => setActiveTab(UPLOAD_DATA_TAB)}
          >
            {UPLOAD_DATA_TAB}
          </button>
        </nav>
      )}

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
    </div>
    {!loading && isUploadTab && (
      <div className="hc-import-panels">
        <section className="hc-panel hc-import-panel">
          <div className="hc-import-column-header">
            <h2 className="hc-import-column-title">VHA SSDB Enrolment Data</h2>
            <button
              type="button"
              className="hc-btn hc-btn-primary hc-import-upload-btn"
              disabled={uploadingEnrolment}
              aria-label={uploadingEnrolment ? 'Uploading enrolment data' : 'Upload enrolment data'}
              onClick={() => enrolmentFileRef.current?.click()}
            >
              <UploadDataIcon />
            </button>
          </div>
          {uploadError && <p className="hc-form-error">{uploadError}</p>}
          {uploadSuccessMessage && <p className="hc-info">{uploadSuccessMessage}</p>}
          <div className="hc-import-column-body">
            <div className="hc-table-wrap hc-import-table-wrap">
              <table className="hc-table hc-table--grid hc-table--import">
                <thead>
                  <tr>
                    <th>Upload</th>
                    <th className="hc-col-import-rows"># Rows</th>
                    <th className="hc-col-import-actions">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {imports.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="hc-import-empty-cell">
                        <span className="hc-muted">No enrolment data uploaded yet.</span>
                      </td>
                    </tr>
                  ) : (
                    imports.map((imp) => {
                      const uploader = imp.importedBy
                        ? uploaderByUserId.get(imp.importedBy)
                        : null;
                      const uploaderName = imp.importedBy
                        ? uploaderLabel(uploader)
                        : 'Unknown';
                      return (
                        <tr key={`${imp.filename}-${imp.importedAt}`}>
                          <td>
                            <div className="hc-import-upload-cell">
                              <span className="hc-import-filename">{imp.filename}</span>
                              <span className="hc-import-upload-meta">
                                {formatImportUploadMeta(uploaderName, imp.importedAt)}
                              </span>
                            </div>
                          </td>
                          <td className="hc-col-import-rows">{imp.count}</td>
                          <td className="hc-col-import-actions">
                            <div className="hc-table-actions">
                              <button
                                type="button"
                                className="hc-btn hc-btn-secondary hc-btn-sm"
                                onClick={() =>
                                  handleDownloadImport(imp.filename, imp.importedAt)
                                }
                              >
                                Download
                              </button>
                              <button
                                type="button"
                                className="hc-btn hc-btn-danger hc-btn-sm"
                                onClick={() =>
                                  void handleDeleteImport(
                                    imp.filename,
                                    imp.importedAt,
                                    imp.count
                                  )
                                }
                              >
                                Delete
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
        </section>
        <section className="hc-panel hc-import-panel">
          <div className="hc-import-column-header">
            <h2 className="hc-import-column-title">Epic Conversion Reports</h2>
            <button
              type="button"
              className="hc-btn hc-btn-primary hc-import-upload-btn"
              disabled={uploadingEpicReport}
              aria-label={uploadingEpicReport ? 'Uploading Epic conversion report' : 'Upload Epic conversion report'}
              onClick={() => epicReportsFileRef.current?.click()}
            >
              <UploadDataIcon />
            </button>
          </div>
          {epicReportError && <p className="hc-form-error">{epicReportError}</p>}
          {reportError && <p className="hc-form-error">{reportError}</p>}
          {epicReportSuccessMessage && <p className="hc-info">{epicReportSuccessMessage}</p>}
          <div className="hc-import-column-body">
            <div className="hc-table-wrap hc-import-table-wrap">
              <table className="hc-table hc-table--grid hc-table--import">
                <thead>
                  <tr>
                    <th>Upload</th>
                    <th className="hc-col-import-rows"># Rows</th>
                    <th className="hc-col-import-actions">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {reportImports.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="hc-import-empty-cell">
                        <span className="hc-muted">No Epic conversion report uploaded yet.</span>
                      </td>
                    </tr>
                  ) : (
                    reportImports.map((imp) => {
                      const uploader = imp.imported_by
                        ? reportUploaderByUserId.get(imp.imported_by)
                        : null;
                      const uploaderName = imp.imported_by
                        ? uploaderLabel(uploader)
                        : 'Unknown';
                      return (
                        <tr key={imp.id}>
                          <td>
                            <div className="hc-import-upload-cell">
                              <span className="hc-import-filename">{imp.source_filename}</span>
                              <span className="hc-import-upload-meta">
                                {formatImportUploadMeta(uploaderName, imp.imported_at)}
                              </span>
                            </div>
                          </td>
                          <td className="hc-col-import-rows">{imp.row_count}</td>
                          <td className="hc-col-import-actions">
                            <div className="hc-table-actions">
                              <button
                                type="button"
                                className="hc-btn hc-btn-danger hc-btn-sm"
                                onClick={() =>
                                  void handleDeleteReportImport(imp.id, imp.source_filename)
                                }
                              >
                                Delete
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
        </section>
      </div>
    )}
    {!loading && isProgressTrackerTab && (
      <ProgressTracker
        metrics={progressMetrics}
        dailyProgressSeries={dailyProgressSeries}
        importActivity={importActivity}
        uploaderByUserId={uploaderByUserId}
        reportImports={reportImports}
        reportUploaderByUserId={reportUploaderByUserId}
        latestSummary={latestSummary}
        reconciliationDetails={reconciliationDetails}
        detailsImportId={detailsImportId}
        onLoadReconciliationDetails={(importId) => void loadReconciliationDetails(importId)}
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
              }
            )}
            <div className="hc-epic-split-tables">
              {renderSplitPanel(
                'Episode Conversion',
                iclConvertRecords,
                'No convert decisions yet.',
                { variant: 'icl', compact: true, expandTarget: 'split' }
              )}
              {renderSplitPanel(
                'Discharge from Program',
                iclDischargeRecords,
                'No discharge decisions yet.',
                { variant: 'icl', compact: true, expandTarget: 'split' }
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
                  expandTarget: 'main',
                }
              )}
              {renderSplitPanel(
                'Episode Conversion Complete',
                episodeConversionCompletedRecords,
                'No completed conversions yet.',
                {
                  variant: 'status',
                  compact: true,
                  compactMode: 'completion',
                  expandTarget: 'split',
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
                { variant: 'discharge', fill: 'main', expandTarget: 'main' }
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
      iclStagedDecisions?: boolean;
      expandTarget?: 'main' | 'split';
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
            <span className="hc-epic-split-panel-count">{groupRecords.length}</span>
          </span>
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
                stackExpandMode === options.expandTarget ? 'Contract panel' : 'Expand panel'
              }
              onClick={() => toggleStackExpand(options.expandTarget!)}
            />
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
    return (
      <div className="hc-table-wrap hc-table-wrap--wide">
        <table
          className={`hc-table hc-table--compact hc-table--epic-compact${
            isDischargeSubmitted ? ' hc-table--epic-compact-discharge-submitted' : ''
          }`}
        >
          <colgroup>
            <col className="hc-epic-compact-col-primary" />
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
                          converted by {emailToUsername(r.completed_by)}
                        </div>
                        <div className="hc-epic-compact-decision-time">
                          {formatDecisionStampAt(r.completed_at)}
                        </div>
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
    }
  ) {
    const showIclDecision = options.variant === 'icl';
    const showDischargeDetails = options.variant === 'discharge';
    const showIclStagedDecisions = options.iclStagedDecisions === true && showIclDecision;
    const useStatusRadio = options.statusInput === 'radio';
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
