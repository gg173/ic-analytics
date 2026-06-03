import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import { carePlanContentKindLabel } from '../carePlan/classifyCarePlanContent';
import {
  buildCarePlanPatientLinks,
  eligibilityReasonLabel,
  getLatestCarePlanRow,
  isCarePlanDateStale,
  computeDefaultLvdDateRange,
  formatIsoDateInputDisplay,
  lvdMatchesToolbarDateRange,
  patientNeedsCarePlanUpdate,
  recordHasTemplatedCarePlan,
  summarizeCarePlanLinks,
  type CarePlanLvdDateRange,
} from '../carePlan/linkCarePlans';
import type { CarePlanContentKind } from '../carePlan/types';
import type {
  CarePlanEligibilityReason,
  CarePlanLinkSummary,
  CarePlanPatientFilter,
  CarePlanPatientLink,
} from '../carePlan/types';

function lvdDateRangesEqual(a: CarePlanLvdDateRange, b: CarePlanLvdDateRange): boolean {
  return a.from === b.from && a.to === b.to;
}

function openToolbarDatePicker(e: MouseEvent<HTMLInputElement>) {
  const input = e.currentTarget;
  if (typeof input.showPicker !== 'function') return;
  try {
    void input.showPicker();
  } catch {
    /* picker already open or unavailable */
  }
}

function ToolbarLvdDateInput({
  value,
  min,
  max,
  ariaLabel,
  onChange,
}: {
  value: string;
  min?: string;
  max?: string;
  ariaLabel: string;
  onChange: (value: string) => void;
}) {
  const displayValue = formatIsoDateInputDisplay(value);

  return (
    <span
      className={`hc-toolbar-lvd-range-input-wrap${
        displayValue ? ' hc-toolbar-lvd-range-input-wrap--has-value' : ''
      }`}
    >
      <input
        type="date"
        className="hc-toolbar-lvd-range-input"
        value={value}
        min={min}
        max={max}
        onClick={openToolbarDatePicker}
        onChange={(e) => onChange(e.target.value)}
        aria-label={ariaLabel}
      />
      {displayValue ? (
        <span className="hc-toolbar-lvd-range-display" aria-hidden>
          {displayValue}
        </span>
      ) : null}
    </span>
  );
}
type CarePlanTableSortKey = 'hosp_dc' | 'latest_care_plan' | 'lvd';
type SortDirection = 'asc' | 'desc';

const EPISODE_CONVERSION_STATUS_FILTER_OPTIONS: readonly CarePlanEligibilityReason[] = [
  'converted',
  'validated',
  'icl_pending',
];
import type { EpicConversionRecord } from '../types';
import { AttachmentIcon } from './CarePlanRowDetailModal';
import { CarePlanRowsListModal } from './CarePlanRowsListModal';
import {
  buildPathwayCarePathFilterGroups,
  isPathwayCarePathFilterActive,
  linkMatchesPathwayCarePathScope,
  matchesPathwayCarePathFilter,
  PATHWAY_CARE_PATH_FILTER_ALL,
  prunePathwayCarePathFilterSelection,
  type PathwayCarePathFilterSelection,
} from '../carePlan/pathwayCarePathFilter';
import { matchesMultiFilter, ToolbarMultiSelect } from './ToolbarMultiSelect';
import { ToolbarPathwayCarePathMultiSelect } from './ToolbarPathwayCarePathMultiSelect';

/** Missing or unparseable dates sort as oldest (first when ascending). */
const SORT_DATE_OLDEST = Number.NEGATIVE_INFINITY;

function sortableSsdbDateTime(value: string | null | undefined): number {
  if (!value?.trim()) return SORT_DATE_OLDEST;
  const t = new Date(`${value.trim()}T12:00:00`).getTime();
  return Number.isNaN(t) ? SORT_DATE_OLDEST : t;
}

function sortableCarePlanSavedTime(value: string | null | undefined): number {
  if (!value?.trim()) return SORT_DATE_OLDEST;
  const t = Date.parse(value.trim());
  return Number.isNaN(t) ? SORT_DATE_OLDEST : t;
}

function compareSortDates(
  a: string | null | undefined,
  b: string | null | undefined,
  direction: SortDirection
): number {
  const cmp = sortableSsdbDateTime(a) - sortableSsdbDateTime(b);
  return direction === 'asc' ? cmp : -cmp;
}

function compareLatestCarePlanDates(
  a: CarePlanPatientLink,
  b: CarePlanPatientLink,
  direction: SortDirection
): number {
  const av = getLatestCarePlanRow(a)?.dateSaved ?? null;
  const bv = getLatestCarePlanRow(b)?.dateSaved ?? null;
  const cmp = sortableCarePlanSavedTime(av) - sortableCarePlanSavedTime(bv);
  return direction === 'asc' ? cmp : -cmp;
}

function compareCarePlanLinks(
  a: CarePlanPatientLink,
  b: CarePlanPatientLink,
  key: CarePlanTableSortKey,
  direction: SortDirection
): number {
  switch (key) {
    case 'hosp_dc':
      return compareSortDates(a.hospDcDate, b.hospDcDate, direction);
    case 'latest_care_plan':
      return compareLatestCarePlanDates(a, b, direction);
    case 'lvd':
      return compareSortDates(a.lvd, b.lvd, direction);
  }
}

function sortCarePlanPatientLinks(
  links: CarePlanPatientLink[],
  sort: { key: CarePlanTableSortKey; direction: SortDirection }
): CarePlanPatientLink[] {
  return [...links].sort((a, b) => compareCarePlanLinks(a, b, sort.key, sort.direction));
}

function matchesEligibilityReasonFilter(
  selected: readonly string[] | null,
  reasons: readonly CarePlanEligibilityReason[],
  options: readonly string[]
): boolean {
  if (selected === null) return true;
  if (options.length === 0) return true;
  if (!selected.length) return false;
  if (!reasons.length) return false;
  return reasons.some((reason) => selected.includes(reason));
}

function matchesCarePlanToolbarFilters(
  link: CarePlanPatientLink,
  search: string,
  pathwayCarePathFilter: PathwayCarePathFilterSelection,
  pathwayCarePathGroups: ReturnType<typeof buildPathwayCarePathFilterGroups>,
  icLeadFilter: string[] | null,
  episodeConversionStatusFilter: string[] | null,
  lvdDateRange: CarePlanLvdDateRange,
  icLeadOptions: readonly string[]
): boolean {
  if (!matchesPathwayCarePathFilter(link, pathwayCarePathFilter, pathwayCarePathGroups)) {
    return false;
  }
  if (!matchesMultiFilter(icLeadFilter, link.icLead, icLeadOptions)) return false;
  if (
    !matchesEligibilityReasonFilter(
      episodeConversionStatusFilter,
      link.eligibilityReasons,
      EPISODE_CONVERSION_STATUS_FILTER_OPTIONS
    )
  ) {
    return false;
  }
  if (!lvdMatchesToolbarDateRange(link.lvd, lvdDateRange)) return false;
  const q = search.trim().toLowerCase();
  if (!q) return true;
  return (
    link.mrn.toLowerCase().includes(q) ||
    (link.gcn?.toLowerCase().includes(q) ?? false) ||
    (link.icLead?.toLowerCase().includes(q) ?? false) ||
    (link.pathway?.toLowerCase().includes(q) ?? false)
  );
}

function ContentKindBadge({ kind }: { kind: CarePlanContentKind }) {
  return (
    <span className={`hc-care-plan-kind hc-care-plan-kind--${kind}`}>
      {carePlanContentKindLabel(kind)}
    </span>
  );
}

function CarePlanCell({
  link,
  onOpenRows,
}: {
  link: CarePlanPatientLink;
  onOpenRows: (link: CarePlanPatientLink) => void;
}) {
  if (link.carePlanRows.length === 0) return '—';

  const kind = recordHasTemplatedCarePlan(link) ? 'templated' : 'unstructured';
  const rowCount = link.carePlanRows.length;

  return (
    <div className="hc-care-plan-cell">
      <ContentKindBadge kind={kind} />
      <button
        type="button"
        className="hc-care-plan-attach-btn"
        aria-label={`View ${rowCount} care plan${rowCount === 1 ? '' : 's'}`}
        title={`View ${rowCount} care plan${rowCount === 1 ? '' : 's'}`}
        onClick={() => onOpenRows(link)}
      >
        <AttachmentIcon />
      </button>
    </div>
  );
}

function RedFlagIcon() {
  return (
    <svg className="hc-care-plan-stale-flag-icon" viewBox="0 0 16 16" width={12} height={12} aria-hidden>
      <path
        fill="currentColor"
        d="M3 1.5v13h1.25V1.5H3zm2.25 0 7.75 3.75-7.75 3.75V1.5Z"
      />
    </svg>
  );
}

function formatSsdbDate(value: string | null | undefined): string {
  if (!value?.trim()) return '—';
  const d = new Date(`${value.trim()}T12:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
  });
}

function formatCarePlanCompletedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const month = d.toLocaleDateString('en-US', { month: 'short' });
  const hours = d.getHours().toString().padStart(2, '0');
  const minutes = d.getMinutes().toString().padStart(2, '0');
  return `${month} ${d.getDate()} ${hours}:${minutes}`;
}

function CarePlanConversionStatusCell({
  recordId,
  disabled,
  onSelectConverted,
}: {
  recordId: string;
  disabled?: boolean;
  onSelectConverted: () => void;
}) {
  return (
    <div className="hc-status-conversion">
      <div
        className="hc-status-radios"
        role="radiogroup"
        aria-label="Care plan conversion status"
      >
        <label className="hc-status-radio-choice">
          <input
            type="radio"
            name={`care-plan-status-${recordId}`}
            className="hc-status-radio"
            checked
            disabled={disabled}
            readOnly
          />
          <span>Pending</span>
        </label>
        <label className="hc-status-radio-choice">
          <input
            type="radio"
            name={`care-plan-status-${recordId}`}
            className="hc-status-radio"
            checked={false}
            disabled={disabled}
            onChange={() => onSelectConverted()}
          />
          <span>Converted</span>
        </label>
      </div>
    </div>
  );
}

function CarePlanConversionCompletedCell({
  completedAt,
  completedBy,
  disabled,
  onUndo,
}: {
  completedAt: string;
  completedBy: string | null;
  disabled?: boolean;
  onUndo: () => void;
}) {
  return (
    <div className="hc-care-plan-completed-status">
      <div className="hc-epic-compact-decision">
        <div className="hc-epic-compact-decision-user">
          Care Plan converted by {completedBy ?? 'unknown'} on{' '}
          {formatCarePlanCompletedAt(completedAt)}
        </div>
      </div>
      <button
        type="button"
        className="hc-epic-compact-undo hc-care-plan-conversion-undo"
        disabled={disabled}
        aria-label="Undo care plan conversion and return to pending"
        title="Return to pending"
        onClick={onUndo}
      >
        ×
      </button>
    </div>
  );
}

function CarePlanPatientsTable({
  links,
  mode,
  tableSort,
  onToggleTableSort,
  updatingRecordId,
  onOpenRows,
  onToggleCarePlanCompleted,
}: {
  links: CarePlanPatientLink[];
  mode: 'pending' | 'completed';
  tableSort: { key: CarePlanTableSortKey; direction: SortDirection } | null;
  onToggleTableSort: (key: CarePlanTableSortKey) => void;
  updatingRecordId: string | null;
  onOpenRows: (link: CarePlanPatientLink) => void;
  onToggleCarePlanCompleted: (recordId: string, completed: boolean) => void;
}) {
  const isPending = mode === 'pending';

  const renderSortableHeader = (
    label: string,
    key: CarePlanTableSortKey,
    className?: string
  ) => {
    const active = tableSort?.key === key;
    const direction = active ? tableSort.direction : null;
    return (
      <th className={className}>
        <button
          type="button"
          className={`hc-table-sort${direction ? ` hc-table-sort--${direction}` : ''}`}
          aria-sort={
            direction ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'
          }
          onClick={() => onToggleTableSort(key)}
        >
          {label}
          <span className="hc-table-sort-indicator" aria-hidden />
        </button>
      </th>
    );
  };

  return (
    <div className="hc-table-wrap hc-table-wrap--wide hc-table-wrap--fill-main">
      <table
        className={`hc-table hc-table--grid hc-table--compact hc-table--care-plan-patients${
          isPending ? '' : ' hc-table--care-plan-patients-completed'
        }`}
      >
        <colgroup>
          <col className="hc-care-plan-col-mrn" />
          <col className="hc-care-plan-col-gcn" />
          <col className="hc-care-plan-col-pathway" />
          <col className="hc-care-plan-col-ic-lead" />
          <col className="hc-care-plan-col-hosp-dc" />
          <col className="hc-care-plan-col-plan" />
          <col className="hc-care-plan-col-latest" />
          <col className="hc-care-plan-col-lvd" />
          {isPending && <col className="hc-care-plan-col-eligibility" />}
          <col className="hc-care-plan-col-care-plan-status" />
        </colgroup>
        <thead>
          <tr>
            <th>MRN</th>
            <th>GC #</th>
            <th>Pathway</th>
            <th>IC Lead</th>
            {renderSortableHeader('Hospital DC Date', 'hosp_dc', 'hc-care-plan-col-hosp-dc')}
            <th>Care Plan</th>
            {renderSortableHeader(
              'Latest Care Plan Date',
              'latest_care_plan',
              'hc-care-plan-col-latest'
            )}
            {renderSortableHeader('LVD', 'lvd', 'hc-care-plan-col-lvd')}
            {isPending && (
              <th className="hc-care-plan-col-eligibility">Episode Conversion Status</th>
            )}
            <th className="hc-care-plan-col-care-plan-status">Care Plan Conversion Status</th>
          </tr>
        </thead>
        <tbody>
          {links.map((link) => {
            const latestCarePlan = getLatestCarePlanRow(link);
            const updating = updatingRecordId === link.recordId;

            return (
              <tr key={link.recordId}>
                <td className="hc-care-plan-col-mrn">{link.mrn}</td>
                <td className="hc-care-plan-col-gcn">{link.gcn ?? '—'}</td>
                <td className="hc-care-plan-col-pathway">{link.pathway ?? '—'}</td>
                <td className="hc-care-plan-col-ic-lead">{link.icLead ?? '—'}</td>
                <td className="hc-care-plan-col-hosp-dc">{formatSsdbDate(link.hospDcDate)}</td>
                <td className="hc-care-plan-col-plan">
                  <CarePlanCell link={link} onOpenRows={onOpenRows} />
                </td>
                <td className="hc-care-plan-col-latest">
                  <LatestCarePlanDateCell dateSaved={latestCarePlan?.dateSaved} />
                </td>
                <td className="hc-care-plan-col-lvd">{formatSsdbDate(link.lvd)}</td>
                {isPending && (
                  <td className="hc-care-plan-col-eligibility">
                    {link.eligibilityReasons.length
                      ? link.eligibilityReasons.map(eligibilityReasonLabel).join(', ')
                      : '—'}
                  </td>
                )}
                <td className="hc-care-plan-col-care-plan-status">
                  {isPending ? (
                    <CarePlanConversionStatusCell
                      recordId={link.recordId}
                      disabled={updating}
                      onSelectConverted={() => onToggleCarePlanCompleted(link.recordId, true)}
                    />
                  ) : link.carePlanCompletedAt ? (
                    <CarePlanConversionCompletedCell
                      completedAt={link.carePlanCompletedAt}
                      completedBy={link.carePlanCompletedBy}
                      disabled={updating}
                      onUndo={() => onToggleCarePlanCompleted(link.recordId, false)}
                    />
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function LatestCarePlanDateCell({ dateSaved }: { dateSaved: string | null | undefined }) {
  const label = dateSaved?.trim();
  if (!label) return null;

  const showStaleFlag = isCarePlanDateStale(label);

  return (
    <span className="hc-care-plan-latest-date">
      {showStaleFlag ? (
        <span
          className="hc-care-plan-stale-flag"
          title="Latest care plan is before 19 May 2026"
          aria-label="Care plan update required"
        >
          <RedFlagIcon />
        </span>
      ) : null}
      {label}
    </span>
  );
}

function formatPercent(count: number, total: number): string {
  if (total === 0) return '—';
  return `${Math.round((count / total) * 100)}%`;
}

function CarePlanStatCount({ count, total }: { count: number; total: number }) {
  return (
    <strong>
      {count}
      {total > 0 ? (
        <span className="hc-care-plan-stat-fraction">
          /{total} ({formatPercent(count, total)})
        </span>
      ) : null}
    </strong>
  );
}

function matchesPatientFilter(
  link: CarePlanPatientLink,
  filter: CarePlanPatientFilter
): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'with_care_plan':
      return link.carePlanRows.length > 0;
    case 'no_care_plan':
      return link.carePlanRows.length === 0;
    case 'templated':
      return recordHasTemplatedCarePlan(link);
    case 'unstructured_only':
      return link.carePlanRows.length > 0 && !recordHasTemplatedCarePlan(link);
    case 'update_required':
      return patientNeedsCarePlanUpdate(link);
  }
}

interface CoverageStatButtonProps<T extends string> {
  filter: T;
  activeFilter: T;
  count: number;
  label: string;
  className: string;
  onFilterChange: (filter: T) => void;
  clearValue?: T;
  denominator?: number;
  labelClassName?: string;
}

function CoverageStatButton<T extends string>({
  filter,
  activeFilter,
  count,
  label,
  className,
  onFilterChange,
  clearValue = 'all' as T,
  denominator,
  labelClassName,
}: CoverageStatButtonProps<T>) {
  const active = activeFilter === filter;

  return (
    <button
      type="button"
      className={`hc-reconcile-stat ${className}${active ? ' hc-reconcile-stat--active' : ''}`}
      aria-pressed={active}
      onClick={() => onFilterChange(active ? clearValue : filter)}
    >
      {denominator != null ? (
        <CarePlanStatCount count={count} total={denominator} />
      ) : (
        <strong>{count}</strong>
      )}
      <span className={labelClassName}>{label}</span>
    </button>
  );
}

function WithCarePlanStatGroup({
  activeFilter,
  summary,
  requiringCarePlanTotal,
  onFilterChange,
}: {
  activeFilter: CarePlanPatientFilter;
  summary: CarePlanLinkSummary;
  requiringCarePlanTotal: number;
  onFilterChange: (filter: CarePlanPatientFilter) => void;
}) {
  const withCarePlanActive =
    activeFilter === 'with_care_plan' ||
    activeFilter === 'templated' ||
    activeFilter === 'unstructured_only' ||
    activeFilter === 'update_required';

  const linkedTotal = summary.withCarePlanCount;

  return (
    <div
      className={`hc-reconcile-stat hc-reconcile-stat--validated hc-care-plan-with-stat${
        withCarePlanActive ? ' hc-reconcile-stat--active' : ''
      }`}
    >
      <button
        type="button"
        className="hc-care-plan-stat-main"
        aria-pressed={activeFilter === 'with_care_plan'}
        onClick={() =>
          onFilterChange(activeFilter === 'with_care_plan' ? 'all' : 'with_care_plan')
        }
      >
        <CarePlanStatCount count={summary.withCarePlanCount} total={requiringCarePlanTotal} />
        <span className="hc-care-plan-stat-label hc-care-plan-stat-label--linked">
          Care Plan Data Linked
        </span>
      </button>
      {(summary.withTemplatedRecordCount > 0 ||
        summary.onlyUnstructuredRecordCount > 0 ||
        summary.carePlanUpdateRequiredCount > 0) && (
        <div className="hc-care-plan-stat-breakdown">
          {summary.withTemplatedRecordCount > 0 && (
            <button
              type="button"
              className={`hc-care-plan-stat-sub hc-care-plan-kind--templated${
                activeFilter === 'templated' ? ' hc-care-plan-stat-sub--active' : ''
              }`}
              aria-pressed={activeFilter === 'templated'}
              onClick={() =>
                onFilterChange(activeFilter === 'templated' ? 'all' : 'templated')
              }
            >
              <CarePlanStatCount
                count={summary.withTemplatedRecordCount}
                total={linkedTotal}
              />
              <span>Conversion Template Used</span>
            </button>
          )}
          {summary.onlyUnstructuredRecordCount > 0 && (
            <button
              type="button"
              className={`hc-care-plan-stat-sub hc-care-plan-kind--unstructured${
                activeFilter === 'unstructured_only' ? ' hc-care-plan-stat-sub--active' : ''
              }`}
              aria-pressed={activeFilter === 'unstructured_only'}
              onClick={() =>
                onFilterChange(activeFilter === 'unstructured_only' ? 'all' : 'unstructured_only')
              }
            >
              <CarePlanStatCount
                count={summary.onlyUnstructuredRecordCount}
                total={linkedTotal}
              />
              <span>Conversion Template Not Used</span>
            </button>
          )}
          {summary.carePlanUpdateRequiredCount > 0 && (
            <button
              type="button"
              className={`hc-care-plan-stat-sub hc-care-plan-kind--update-required${
                activeFilter === 'update_required' ? ' hc-care-plan-stat-sub--active' : ''
              }`}
              aria-pressed={activeFilter === 'update_required'}
              onClick={() =>
                onFilterChange(activeFilter === 'update_required' ? 'all' : 'update_required')
              }
            >
              <CarePlanStatCount
                count={summary.carePlanUpdateRequiredCount}
                total={linkedTotal}
              />
              <span>Care Plan Update Required</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

interface CarePlanConversionPanelProps {
  hasCarePlanImports: boolean;
  patientLinks: CarePlanPatientLink[];
  updatingRecordId: string | null;
  onToggleCarePlanCompleted: (recordId: string, completed: boolean) => void;
}

export function CarePlanConversionPanel({
  hasCarePlanImports,
  patientLinks,
  updatingRecordId,
  onToggleCarePlanCompleted,
}: CarePlanConversionPanelProps) {
  const [patientFilter, setPatientFilter] = useState<CarePlanPatientFilter>('all');
  const [selectedPatientCarePlans, setSelectedPatientCarePlans] =
    useState<CarePlanPatientLink | null>(null);
  const [search, setSearch] = useState('');
  const [pathwayCarePathFilter, setPathwayCarePathFilter] =
    useState<PathwayCarePathFilterSelection>(PATHWAY_CARE_PATH_FILTER_ALL);
  const [icLeadFilter, setIcLeadFilter] = useState<string[] | null>(null);
  const [episodeConversionStatusFilter, setEpisodeConversionStatusFilter] = useState<
    string[] | null
  >(null);
  const defaultLvdDateRange = useMemo(
    () => computeDefaultLvdDateRange(patientLinks),
    [patientLinks]
  );
  const [lvdDateRange, setLvdDateRange] = useState<CarePlanLvdDateRange>(defaultLvdDateRange);
  const [tableSort, setTableSort] = useState<{
    key: CarePlanTableSortKey;
    direction: SortDirection;
  } | null>(null);

  useEffect(() => {
    setLvdDateRange(defaultLvdDateRange);
  }, [defaultLvdDateRange]);

  const toggleTableSort = (key: CarePlanTableSortKey) => {
    setTableSort((prev) => {
      if (prev?.key === key) {
        return { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
      }
      return { key, direction: 'asc' };
    });
  };

  const pathwayCarePathGroups = useMemo(
    () => buildPathwayCarePathFilterGroups(patientLinks),
    [patientLinks]
  );
  const icLeadOptions = useMemo(() => {
    const set = new Set<string>();
    for (const link of patientLinks) {
      if (!linkMatchesPathwayCarePathScope(link, pathwayCarePathFilter, pathwayCarePathGroups)) {
        continue;
      }
      if (link.icLead) set.add(link.icLead);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [patientLinks, pathwayCarePathFilter, pathwayCarePathGroups]);

  useEffect(() => {
    setPathwayCarePathFilter((current) => {
      const pruned = prunePathwayCarePathFilterSelection(current, pathwayCarePathGroups);
      return pruned === current ? current : pruned;
    });
  }, [pathwayCarePathGroups]);

  const hasActiveToolbarFilters =
    search.trim() !== '' ||
    isPathwayCarePathFilterActive(pathwayCarePathFilter) ||
    icLeadFilter !== null ||
    episodeConversionStatusFilter !== null ||
    !lvdDateRangesEqual(lvdDateRange, defaultLvdDateRange);

  const toolbarScopedLinks = useMemo(
    () =>
      patientLinks.filter((link) =>
        matchesCarePlanToolbarFilters(
          link,
          search,
          pathwayCarePathFilter,
          pathwayCarePathGroups,
          icLeadFilter,
          episodeConversionStatusFilter,
          lvdDateRange,
          icLeadOptions
        )
      ),
    [
      patientLinks,
      search,
      pathwayCarePathFilter,
      pathwayCarePathGroups,
      icLeadFilter,
      episodeConversionStatusFilter,
      lvdDateRange,
      icLeadOptions,
    ]
  );

  const displaySummary = useMemo(
    () => summarizeCarePlanLinks(toolbarScopedLinks),
    [toolbarScopedLinks]
  );

  const filteredPatientLinks = useMemo(
    () =>
      patientLinks
        .filter((link) => matchesPatientFilter(link, patientFilter))
        .filter((link) =>
          matchesCarePlanToolbarFilters(
            link,
            search,
            pathwayCarePathFilter,
            pathwayCarePathGroups,
            icLeadFilter,
            episodeConversionStatusFilter,
            lvdDateRange,
            icLeadOptions
          )
        ),
    [
      patientLinks,
      patientFilter,
      search,
      pathwayCarePathFilter,
      pathwayCarePathGroups,
      icLeadFilter,
      episodeConversionStatusFilter,
      lvdDateRange,
      icLeadOptions,
    ]
  );

  const pendingPatientLinks = useMemo(() => {
    const pending = filteredPatientLinks.filter((link) => !link.carePlanCompletedAt);
    return tableSort ? sortCarePlanPatientLinks(pending, tableSort) : pending;
  }, [filteredPatientLinks, tableSort]);

  const completedPatientLinks = useMemo(() => {
    const completed = filteredPatientLinks.filter((link) => link.carePlanCompletedAt);
    return tableSort ? sortCarePlanPatientLinks(completed, tableSort) : completed;
  }, [filteredPatientLinks, tableSort]);

  if (!hasCarePlanImports) {
    return (
      <section className="hc-epic-split-panel hc-epic-split-panel--main hc-care-plan-conversion">
        <h3 className="hc-epic-split-panel-title">
          <span className="hc-epic-split-panel-title-main">Care Plan Conversion</span>
        </h3>
        <p className="hc-muted hc-epic-split-panel-empty">
          No VHA EMRI care plan templates uploaded yet. Upload a file on the Import Data tab.
        </p>
      </section>
    );
  }

  const requiringCarePlanTotal = displaySummary.totalRecordCount;

  return (
    <div className="hc-epic-table-stack hc-care-plan-conversion-stack">
      {selectedPatientCarePlans && (
        <CarePlanRowsListModal
          mrn={selectedPatientCarePlans.mrn}
          rows={selectedPatientCarePlans.carePlanRows}
          pathway={selectedPatientCarePlans.pathway}
          carePath={selectedPatientCarePlans.carePath}
          icLead={selectedPatientCarePlans.icLead}
          hospDcDate={selectedPatientCarePlans.hospDcDate}
          onClose={() => setSelectedPatientCarePlans(null)}
        />
      )}
      <section className="hc-epic-split-panel hc-epic-split-panel--main hc-care-plan-conversion">
        <h3 className="hc-epic-split-panel-title">
          <span className="hc-epic-split-panel-title-main">
            Pending Care Plan Conversion
            <span className="hc-epic-split-panel-count">{pendingPatientLinks.length}</span>
          </span>
        </h3>

        <div className="hc-progress-reconcile-summary hc-progress-reconcile-summary--care-plan">
        <CoverageStatButton
          filter="all"
          activeFilter={patientFilter}
          count={displaySummary.totalRecordCount}
          label="Episodes for Care Planning"
          className="hc-care-plan-scope-stat"
          onFilterChange={setPatientFilter}
        />
        <WithCarePlanStatGroup
          activeFilter={patientFilter}
          summary={displaySummary}
          requiringCarePlanTotal={requiringCarePlanTotal}
          onFilterChange={setPatientFilter}
        />
        <CoverageStatButton
          filter="no_care_plan"
          activeFilter={patientFilter}
          count={displaySummary.withoutCarePlanCount}
          denominator={requiringCarePlanTotal}
          label="No Care Plan Data"
          labelClassName="hc-care-plan-stat-label hc-care-plan-stat-label--no-data"
          className="hc-reconcile-stat--unmatched"
          onFilterChange={setPatientFilter}
        />
      </div>

      {patientLinks.length > 0 && (
        <div className="hc-toolbar">
          <label className="hc-search hc-search--care-plan">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search MRN, Pathway, IC Lead"
              aria-label="Search MRN, Pathway, IC Lead"
            />
          </label>
          <div className="hc-toolbar-field hc-toolbar-field--episode-conversion">
            Conversion Status
            <ToolbarMultiSelect
              options={[...EPISODE_CONVERSION_STATUS_FILTER_OPTIONS]}
              selected={episodeConversionStatusFilter}
              onChange={setEpisodeConversionStatusFilter}
              ariaLabel="Filter by conversion status"
              maxLabelsBeforeCount={1}
              formatOptionLabel={(value) =>
                eligibilityReasonLabel(value as CarePlanEligibilityReason)
              }
            />
          </div>
          <div className="hc-toolbar-field hc-toolbar-field--pathway">
            Pathway
            <ToolbarPathwayCarePathMultiSelect
              groups={pathwayCarePathGroups}
              selection={pathwayCarePathFilter}
              onChange={setPathwayCarePathFilter}
              ariaLabel="Filter by pathway and care path"
              maxLabelsBeforeCount={3}
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
          <div
            className="hc-toolbar-field hc-toolbar-field--lvd"
            role="group"
            aria-label="Filter by LVD date range"
          >
            LVD
            <span className="hc-toolbar-lvd-range">
              <ToolbarLvdDateInput
                value={lvdDateRange.from}
                max={lvdDateRange.to || undefined}
                ariaLabel="LVD from date"
                onChange={(from) => setLvdDateRange((prev) => ({ ...prev, from }))}
              />
              <span className="hc-toolbar-lvd-range-sep" aria-hidden>
                –
              </span>
              <ToolbarLvdDateInput
                value={lvdDateRange.to}
                min={lvdDateRange.from || undefined}
                ariaLabel="LVD to date"
                onChange={(to) => setLvdDateRange((prev) => ({ ...prev, to }))}
              />
            </span>
          </div>
          {hasActiveToolbarFilters && (
            <button
              type="button"
              className="hc-btn hc-btn-secondary hc-toolbar-clear"
              onClick={() => {
                setSearch('');
                setPathwayCarePathFilter(PATHWAY_CARE_PATH_FILTER_ALL);
                setIcLeadFilter(null);
                setEpisodeConversionStatusFilter(null);
                setLvdDateRange(defaultLvdDateRange);
              }}
            >
              Clear Filters
            </button>
          )}
        </div>
      )}

      {patientLinks.length === 0 ? (
        <p className="hc-muted hc-epic-split-panel-empty">
          No VHA SSDB enrolment records loaded yet.
        </p>
      ) : filteredPatientLinks.length === 0 ? (
        <p className="hc-muted hc-epic-split-panel-empty">No records match the selected filter.</p>
      ) : pendingPatientLinks.length === 0 ? (
        <p className="hc-muted hc-epic-split-panel-empty">No pending care plan conversions.</p>
      ) : (
        <CarePlanPatientsTable
          links={pendingPatientLinks}
          mode="pending"
          tableSort={tableSort}
          onToggleTableSort={toggleTableSort}
          updatingRecordId={updatingRecordId}
          onOpenRows={setSelectedPatientCarePlans}
          onToggleCarePlanCompleted={onToggleCarePlanCompleted}
        />
      )}
      </section>

      <div className="hc-care-plan-split-tables">
        <section className="hc-epic-split-panel hc-care-plan-conversion">
          <h3 className="hc-epic-split-panel-title">
            <span className="hc-epic-split-panel-title-main">
              Care Plan Conversion Complete
              <span className="hc-epic-split-panel-count">{completedPatientLinks.length}</span>
            </span>
          </h3>
          {patientLinks.length === 0 || filteredPatientLinks.length === 0 ? null : completedPatientLinks.length === 0 ? (
            <p className="hc-muted hc-epic-split-panel-empty">
              No completed care plan conversions yet.
            </p>
          ) : (
            <CarePlanPatientsTable
              links={completedPatientLinks}
              mode="completed"
              tableSort={tableSort}
              onToggleTableSort={toggleTableSort}
              updatingRecordId={updatingRecordId}
              onOpenRows={setSelectedPatientCarePlans}
              onToggleCarePlanCompleted={onToggleCarePlanCompleted}
            />
          )}
        </section>
      </div>
    </div>
  );
}

export function useCarePlanConversionData(
  records: EpicConversionRecord[],
  carePlanRows: import('../carePlan/types').EpicCarePlanRow[],
  importFilenames: Map<string, string>,
  validatedRecordIds: ReadonlySet<string>
) {
  return useMemo(() => {
    const patientLinks = buildCarePlanPatientLinks(
      records,
      carePlanRows,
      validatedRecordIds,
      importFilenames
    );
    const summary = summarizeCarePlanLinks(patientLinks);

    return { patientLinks, summary };
  }, [records, carePlanRows, importFilenames, validatedRecordIds]);
}
