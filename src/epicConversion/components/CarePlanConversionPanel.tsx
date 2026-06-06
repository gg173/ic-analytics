import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { useResizableTableColumns } from '../../hooks/useResizableTableColumns';
import {
  buildCarePlanPatientLinks,
  buildDefaultCarePlanVisitDateRange,
  carePlanDateRangesEqual,
  eligibilityReasonLabel,
  getLatestCarePlanRow,
  getPatientVisitCountInRange,
  isCarePlanConversionRowComplete,
  isCarePlanDateStale,
  formatIsoDateInputDisplay,
  patientHasSsdbVisitInToolbarDateRange,
  patientNeedsCarePlanUpdate,
  recordHasTemplatedCarePlan,
  summarizeCarePlanLinks,
  visitDateRangeIsActive,
  type CarePlanDateRange,
} from '../carePlan/linkCarePlans';
import type {
  CarePlanEligibilityReason,
  CarePlanLinkSummary,
  CarePlanPatientFilter,
  CarePlanPatientLink,
} from '../carePlan/types';

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
type CarePlanTableSortKey = 'hosp_dc' | 'latest_care_plan' | 'visit_count';
type SortDirection = 'asc' | 'desc';

const EPISODE_CONVERSION_STATUS_FILTER_OPTIONS: readonly CarePlanEligibilityReason[] = [
  'converted',
  'validated',
  'icl_pending',
];
import type { PatientSsdbServiceDetail, ServiceDayService } from '../serviceData/linkServiceDayCarePlans';
import type { EpicConversionRecord } from '../types';
import { DocumentIcon } from './CarePlanRowDetailModal';
import { PatientCareOverviewModal } from './PatientCareOverviewModal';
import {
  buildPathwayCarePathFilterGroups,
  isPathwayCarePathFilterActive,
  linkMatchesPathwayCarePathScope,
  matchesPathwayCarePathFilter,
  PATHWAY_CARE_PATH_FILTER_ALL,
  prunePathwayCarePathFilterSelection,
  type PathwayCarePathFilterSelection,
} from '../carePlan/pathwayCarePathFilter';
import { downloadCarePlanConversionXlsx } from '../export/buildCarePlanConversionXlsx';
import { TableExportButton } from './TableExportButton';
import { matchesMultiFilter, ToolbarMultiSelect } from './ToolbarMultiSelect';
import { ToolbarPathwayCarePathMultiSelect } from './ToolbarPathwayCarePathMultiSelect';

function exportCarePlanTableXlsx(
  links: CarePlanPatientLink[],
  mode: 'pending' | 'completed'
): void {
  const date = new Date().toISOString().slice(0, 10);
  const slug = mode === 'pending' ? 'pending-care-plan-conversion' : 'completed-care-plan-conversion';
  downloadCarePlanConversionXlsx(links, `${slug}-${date}.xlsx`, mode);
}

function renderPanelExportButton(
  links: CarePlanPatientLink[],
  mode: 'pending' | 'completed',
  ariaLabel: string
) {
  return (
    <TableExportButton
      disabled={links.length === 0}
      ariaLabel={ariaLabel}
      onClick={() => exportCarePlanTableXlsx(links, mode)}
    />
  );
}

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

function compareVisitCounts(
  a: CarePlanPatientLink,
  b: CarePlanPatientLink,
  visitCountsByEnrollId: ReadonlyMap<string, number> | null,
  direction: SortDirection
): number {
  const aCount = getPatientVisitCountInRange(a.enrollId, visitCountsByEnrollId) ?? -1;
  const bCount = getPatientVisitCountInRange(b.enrollId, visitCountsByEnrollId) ?? -1;
  const cmp = aCount - bCount;
  return direction === 'asc' ? cmp : -cmp;
}

function compareCarePlanLinks(
  a: CarePlanPatientLink,
  b: CarePlanPatientLink,
  key: CarePlanTableSortKey,
  direction: SortDirection,
  visitCountsByEnrollId: ReadonlyMap<string, number> | null
): number {
  switch (key) {
    case 'hosp_dc':
      return compareSortDates(a.hospDcDate, b.hospDcDate, direction);
    case 'latest_care_plan':
      return compareLatestCarePlanDates(a, b, direction);
    case 'visit_count':
      return compareVisitCounts(a, b, visitCountsByEnrollId, direction);
  }
}

function sortCarePlanPatientLinks(
  links: CarePlanPatientLink[],
  sort: { key: CarePlanTableSortKey; direction: SortDirection },
  visitCountsByEnrollId: ReadonlyMap<string, number> | null
): CarePlanPatientLink[] {
  return [...links].sort((a, b) =>
    compareCarePlanLinks(a, b, sort.key, sort.direction, visitCountsByEnrollId)
  );
}

function formatPatientVisitCount(
  enrollId: string | null | undefined,
  visitCountsByEnrollId: ReadonlyMap<string, number> | null,
  hasServiceDataImports: boolean
): string {
  if (!hasServiceDataImports) return '—';
  const count = getPatientVisitCountInRange(enrollId, visitCountsByEnrollId);
  if (count == null) return '—';
  return String(count);
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
  visitDateRange: CarePlanDateRange,
  visitCountsByEnrollId: ReadonlyMap<string, number> | null,
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
  if (
    !patientHasSsdbVisitInToolbarDateRange(
      link.enrollId,
      visitCountsByEnrollId,
      visitDateRange
    )
  ) {
    return false;
  }
  const q = search.trim().toLowerCase();
  if (!q) return true;
  return (
    link.mrn.toLowerCase().includes(q) ||
    (link.gcn?.toLowerCase().includes(q) ?? false) ||
    (link.icLead?.toLowerCase().includes(q) ?? false) ||
    (link.pathway?.toLowerCase().includes(q) ?? false)
  );
}

function MedicationIcon() {
  return (
    <svg
      className="hc-care-plan-doc-icon"
      xmlns="http://www.w3.org/2000/svg"
      width="1em"
      height="1em"
      viewBox="0 0 16 16"
      aria-hidden
    >
      <path d="M0 0h16v16H0z" fill="none" />
      <path
        fill="currentColor"
        d="M8 3.05A3.5 3.5 0 1 1 12.95 8L8 12.95A3.5 3.5 0 0 1 3.05 8zm2.122 6.364l2.12-2.12a2.5 2.5 0 0 0-3.535-3.536l-2.121 2.12zm-2.268 1.44a.5.5 0 1 0-.708-.707l-1.5 1.5a.5.5 0 1 0 .708.707z"
      />
    </svg>
  );
}

function CarePlanConversionBadge({
  link,
  onOpenRows,
}: {
  link: CarePlanPatientLink;
  onOpenRows: (link: CarePlanPatientLink) => void;
}) {
  if (link.carePlanRows.length === 0) return null;

  const kind = recordHasTemplatedCarePlan(link) ? 'templated' : 'unstructured';
  const rowCount = link.carePlanRows.length;

  return (
    <button
      type="button"
      className={`hc-care-plan-conversion-badge hc-care-plan-kind hc-care-plan-kind--${kind}`}
      aria-label={`View ${rowCount} care plan${rowCount === 1 ? '' : 's'}`}
      title={`View ${rowCount} care plan${rowCount === 1 ? '' : 's'}`}
      onClick={() => onOpenRows(link)}
    >
      <span className="hc-care-plan-conversion-badge-label">View Care Plan</span>
      <DocumentIcon />
    </button>
  );
}

function EmarConversionBadge({
  link,
  onOpenRows,
}: {
  link: CarePlanPatientLink;
  onOpenRows: (link: CarePlanPatientLink) => void;
}) {
  if (link.emarRows.length === 0) return null;

  const rowCount = link.emarRows.length;

  return (
    <button
      type="button"
      className="hc-care-plan-conversion-badge hc-care-plan-kind hc-care-plan-kind--templated"
      aria-label={`View ${rowCount} eMAR medication${rowCount === 1 ? '' : 's'}`}
      title={`View ${rowCount} eMAR medication${rowCount === 1 ? '' : 's'}`}
      onClick={() => onOpenRows(link)}
    >
      <span className="hc-care-plan-conversion-badge-label">View eMAR</span>
      <MedicationIcon />
    </button>
  );
}

function EmarConversionCell({
  link,
  disabled,
  onOpenRows,
  onToggleEmarCompleted,
}: {
  link: CarePlanPatientLink;
  disabled?: boolean;
  onOpenRows: (link: CarePlanPatientLink) => void;
  onToggleEmarCompleted: (recordId: string, completed: boolean) => void;
}) {
  const hasBadge = link.emarRows.length > 0;

  if (!hasBadge) {
    return <span className="hc-care-plan-no-emar">No eMAR</span>;
  }

  return (
    <div className="hc-care-plan-conversion-cell">
      <EmarConversionBadge link={link} onOpenRows={onOpenRows} />
      <label className="hc-care-plan-conversion-checkbox">
        <input
          type="checkbox"
          className="hc-status-checkbox"
          checked={!!link.emarCompletedAt}
          disabled={disabled}
          onChange={() => onToggleEmarCompleted(link.recordId, !link.emarCompletedAt)}
        />
        <span>eMAR Entered in Epic</span>
      </label>
    </div>
  );
}

function CarePlanConversionCell({
  link,
  mode,
  disabled,
  onOpenRows,
  onToggleCarePlanCompleted,
}: {
  link: CarePlanPatientLink;
  mode: 'pending' | 'completed';
  disabled?: boolean;
  onOpenRows: (link: CarePlanPatientLink) => void;
  onToggleCarePlanCompleted: (recordId: string, completed: boolean) => void;
}) {
  const isPending = mode === 'pending';
  const hasBadge = link.carePlanRows.length > 0;

  if (!isPending && !link.carePlanCompletedAt && !hasBadge) {
    return null;
  }

  return (
    <div className="hc-care-plan-conversion-cell">
      {hasBadge ? (
        <CarePlanConversionBadge link={link} onOpenRows={onOpenRows} />
      ) : isPending ? (
        <span className="hc-muted">—</span>
      ) : null}
      {isPending ? (
        <label className="hc-care-plan-conversion-checkbox">
          <input
            type="checkbox"
            className="hc-status-checkbox"
            checked={!!link.carePlanCompletedAt}
            disabled={disabled}
            onChange={() =>
              onToggleCarePlanCompleted(link.recordId, !link.carePlanCompletedAt)
            }
          />
          <span>Care Plan Entered in Epic</span>
        </label>
      ) : link.carePlanCompletedAt ? (
        <CarePlanConversionCompletedCell
          completedAt={link.carePlanCompletedAt}
          completedBy={link.carePlanCompletedBy}
          disabled={disabled}
          onUndo={() => onToggleCarePlanCompleted(link.recordId, false)}
        />
      ) : null}
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

const PENDING_CARE_PLAN_TABLE_COLUMNS = [
  'mrn',
  'gcn',
  'pathway',
  'ic-lead',
  'hosp-dc',
  'latest',
  'lvd',
  'eligibility',
  'conversion',
  'emar-conversion',
] as const;

function carePlanColumnClass(columnId: string): string {
  return `hc-care-plan-col-${columnId}`;
}

function CarePlanTableHeaderCell({
  columnId,
  className,
  resizable,
  onStartResize,
  children,
}: {
  columnId: string;
  className?: string;
  resizable: boolean;
  onStartResize: (columnId: string, clientX: number) => void;
  children: ReactNode;
}) {
  return (
    <th className={className}>
      {children}
      {resizable ? (
        <span
          className="hc-table-col-resize-handle"
          role="separator"
          aria-orientation="vertical"
          aria-label={`Resize ${columnId} column`}
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onStartResize(columnId, event.clientX);
          }}
        />
      ) : null}
    </th>
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
  onOpenEmarRows,
  onToggleEmarCompleted,
  visitCountsByEnrollId,
  hasServiceDataImports,
}: {
  links: CarePlanPatientLink[];
  mode: 'pending' | 'completed';
  tableSort: { key: CarePlanTableSortKey; direction: SortDirection } | null;
  onToggleTableSort: (key: CarePlanTableSortKey) => void;
  updatingRecordId: string | null;
  onOpenRows: (link: CarePlanPatientLink) => void;
  onToggleCarePlanCompleted: (recordId: string, completed: boolean) => void;
  onOpenEmarRows?: (link: CarePlanPatientLink) => void;
  onToggleEmarCompleted?: (recordId: string, completed: boolean) => void;
  visitCountsByEnrollId: ReadonlyMap<string, number> | null;
  hasServiceDataImports: boolean;
}) {
  const isPending = mode === 'pending';
  const tableRef = useRef<HTMLTableElement>(null);
  const columnIds = isPending ? PENDING_CARE_PLAN_TABLE_COLUMNS : [];
  const { getColumnStyle, startResize } = useResizableTableColumns(
    tableRef,
    columnIds,
    isPending
  );

  const renderSortableHeader = (
    label: string,
    key: CarePlanTableSortKey,
    columnId: string
  ) => {
    const active = tableSort?.key === key;
    const direction = active ? tableSort.direction : null;
    return (
      <CarePlanTableHeaderCell
        columnId={columnId}
        className={carePlanColumnClass(columnId)}
        resizable={isPending}
        onStartResize={startResize}
      >
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
      </CarePlanTableHeaderCell>
    );
  };

  const pendingColumns = isPending ? PENDING_CARE_PLAN_TABLE_COLUMNS : null;

  return (
    <div
      className={`hc-table-wrap hc-table-wrap--wide hc-table-wrap--fill-main${
        isPending ? ' hc-table-wrap--resizable-columns' : ''
      }`}
    >
      <table
        ref={tableRef}
        className={`hc-table hc-table--grid hc-table--compact hc-table--care-plan-patients${
          isPending ? ' hc-table--care-plan-patients-resizable' : ' hc-table--care-plan-patients-completed'
        }`}
      >
        <colgroup>
          {pendingColumns ? (
            pendingColumns.map((columnId) => (
              <col
                key={columnId}
                className={carePlanColumnClass(columnId)}
                style={getColumnStyle(columnId)}
              />
            ))
          ) : (
            <>
              <col className="hc-care-plan-col-mrn" />
              <col className="hc-care-plan-col-gcn" />
              <col className="hc-care-plan-col-pathway" />
              <col className="hc-care-plan-col-ic-lead" />
              <col className="hc-care-plan-col-hosp-dc" />
              <col className="hc-care-plan-col-latest" />
              <col className="hc-care-plan-col-lvd" />
              <col className="hc-care-plan-col-conversion" />
            </>
          )}
        </colgroup>
        <thead>
          <tr>
            <CarePlanTableHeaderCell
              columnId="mrn"
              className={carePlanColumnClass('mrn')}
              resizable={isPending}
              onStartResize={startResize}
            >
              MRN
            </CarePlanTableHeaderCell>
            <CarePlanTableHeaderCell
              columnId="gcn"
              className={carePlanColumnClass('gcn')}
              resizable={isPending}
              onStartResize={startResize}
            >
              GC #
            </CarePlanTableHeaderCell>
            <CarePlanTableHeaderCell
              columnId="pathway"
              className={carePlanColumnClass('pathway')}
              resizable={isPending}
              onStartResize={startResize}
            >
              Pathway
            </CarePlanTableHeaderCell>
            <CarePlanTableHeaderCell
              columnId="ic-lead"
              className={carePlanColumnClass('ic-lead')}
              resizable={isPending}
              onStartResize={startResize}
            >
              IC Lead
            </CarePlanTableHeaderCell>
            {renderSortableHeader('Hospital DC Date', 'hosp_dc', 'hosp-dc')}
            {renderSortableHeader('Latest Care Plan Date', 'latest_care_plan', 'latest')}
            {renderSortableHeader('# Visits', 'visit_count', 'lvd')}
            {isPending && (
              <CarePlanTableHeaderCell
                columnId="eligibility"
                className={carePlanColumnClass('eligibility')}
                resizable
                onStartResize={startResize}
              >
                Episode Conversion Status
              </CarePlanTableHeaderCell>
            )}
            <CarePlanTableHeaderCell
              columnId="conversion"
              className={carePlanColumnClass('conversion')}
              resizable={isPending}
              onStartResize={startResize}
            >
              Care Plan Conversion
            </CarePlanTableHeaderCell>
            {isPending && (
              <CarePlanTableHeaderCell
                columnId="emar-conversion"
                className={carePlanColumnClass('emar-conversion')}
                resizable
                onStartResize={startResize}
              >
                eMAR Conversion
              </CarePlanTableHeaderCell>
            )}
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
                <td className="hc-care-plan-col-latest">
                  <LatestCarePlanDateCell dateSaved={latestCarePlan?.dateSaved} />
                </td>
                <td className="hc-care-plan-col-lvd">
                  {formatPatientVisitCount(
                    link.enrollId,
                    visitCountsByEnrollId,
                    hasServiceDataImports
                  )}
                </td>
                {isPending && (
                  <td className="hc-care-plan-col-eligibility">
                    {link.eligibilityReasons.length
                      ? link.eligibilityReasons.map(eligibilityReasonLabel).join(', ')
                      : '—'}
                  </td>
                )}
                <td className="hc-care-plan-col-conversion">
                  <CarePlanConversionCell
                    link={link}
                    mode={mode}
                    disabled={updating}
                    onOpenRows={onOpenRows}
                    onToggleCarePlanCompleted={onToggleCarePlanCompleted}
                  />
                </td>
                {isPending && onOpenEmarRows && onToggleEmarCompleted && (
                  <td className="hc-care-plan-col-emar-conversion">
                    <EmarConversionCell
                      link={link}
                      disabled={updating}
                      onOpenRows={onOpenEmarRows}
                      onToggleEmarCompleted={onToggleEmarCompleted}
                    />
                  </td>
                )}
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
    <strong className="hc-care-plan-stat-count">
      <span className="hc-care-plan-stat-numerator">{count}</span>
      {total > 0 ? (
        <span className="hc-care-plan-stat-fraction">
          /{total} ({formatPercent(count, total)})
        </span>
      ) : null}
    </strong>
  );
}

function CarePlanStatLabel({
  line1,
  line2,
  className,
}: {
  line1: string;
  line2: string;
  className?: string;
}) {
  return (
    <span className={['hc-care-plan-stat-label', className].filter(Boolean).join(' ')}>
      <span className="hc-care-plan-stat-label-line">{line1}</span>
      <span className="hc-care-plan-stat-label-line">{line2}</span>
    </span>
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
  labelLine1: string;
  labelLine2: string;
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
  labelLine1,
  labelLine2,
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
      <CarePlanStatLabel line1={labelLine1} line2={labelLine2} className={labelClassName} />
      {denominator != null ? (
        <CarePlanStatCount count={count} total={denominator} />
      ) : (
        <strong>{count}</strong>
      )}
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
        <CarePlanStatLabel
          line1="Care Plan"
          line2="Data Linked"
          className="hc-care-plan-stat-label--linked"
        />
        <CarePlanStatCount count={summary.withCarePlanCount} total={requiringCarePlanTotal} />
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
              <CarePlanStatLabel line1="Conversion" line2="Template Used" />
              <CarePlanStatCount
                count={summary.withTemplatedRecordCount}
                total={linkedTotal}
              />
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
              <CarePlanStatLabel line1="Conversion" line2="Template Not Used" />
              <CarePlanStatCount
                count={summary.onlyUnstructuredRecordCount}
                total={linkedTotal}
              />
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
              <CarePlanStatLabel line1="Care Plan" line2="Update Required" />
              <CarePlanStatCount
                count={summary.carePlanUpdateRequiredCount}
                total={linkedTotal}
              />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function countPendingCarePlanLinks(
  patientLinks: CarePlanPatientLink[],
  visitDateRange: CarePlanDateRange,
  visitCountsByEnrollId: ReadonlyMap<string, number> | null
): number {
  const pathwayCarePathGroups = buildPathwayCarePathFilterGroups(patientLinks);
  return patientLinks
    .filter((link) => !isCarePlanConversionRowComplete(link))
    .filter((link) =>
      matchesCarePlanToolbarFilters(
        link,
        '',
        PATHWAY_CARE_PATH_FILTER_ALL,
        pathwayCarePathGroups,
        null,
        null,
        visitDateRange,
        visitCountsByEnrollId,
        []
      )
    ).length;
}

export function useCarePlanTabPendingCount({
  patientLinks,
  hasServiceDataImports,
  serviceDataRefreshKey,
  fetchSsdbServiceDateBounds,
  fetchVisitCountsByEnrollIdInDateRange,
}: {
  patientLinks: CarePlanPatientLink[];
  hasServiceDataImports: boolean;
  serviceDataRefreshKey: string;
  fetchSsdbServiceDateBounds: () => Promise<{
    from: string;
    to: string;
    error: string | null;
  }>;
  fetchVisitCountsByEnrollIdInDateRange: (
    startDate: string,
    endDate: string
  ) => Promise<{ visitCountsByEnrollId: Map<string, number>; error: string | null }>;
}): number {
  const emptyVisitDateRange = useMemo<CarePlanDateRange>(() => ({ from: '', to: '' }), []);
  const [visitDateRange, setVisitDateRange] = useState<CarePlanDateRange>(emptyVisitDateRange);
  const [visitCountsByEnrollId, setVisitCountsByEnrollId] = useState<Map<string, number> | null>(
    () => new Map()
  );

  useEffect(() => {
    if (!hasServiceDataImports) {
      setVisitDateRange(emptyVisitDateRange);
      setVisitCountsByEnrollId(new Map());
      return;
    }

    let cancelled = false;
    void fetchSsdbServiceDateBounds().then(({ from }) => {
      if (cancelled) return;
      setVisitDateRange(buildDefaultCarePlanVisitDateRange(from));
    });

    return () => {
      cancelled = true;
    };
  }, [
    hasServiceDataImports,
    serviceDataRefreshKey,
    fetchSsdbServiceDateBounds,
    emptyVisitDateRange,
  ]);

  useEffect(() => {
    if (!hasServiceDataImports || !visitDateRangeIsActive(visitDateRange)) {
      setVisitCountsByEnrollId(new Map());
      return;
    }

    let cancelled = false;
    setVisitCountsByEnrollId(null);
    void fetchVisitCountsByEnrollIdInDateRange(visitDateRange.from, visitDateRange.to).then(
      ({ visitCountsByEnrollId: counts }) => {
        if (!cancelled) {
          setVisitCountsByEnrollId(counts);
        }
      }
    );

    return () => {
      cancelled = true;
    };
  }, [
    hasServiceDataImports,
    serviceDataRefreshKey,
    visitDateRange,
    fetchVisitCountsByEnrollIdInDateRange,
  ]);

  return useMemo(
    () => countPendingCarePlanLinks(patientLinks, visitDateRange, visitCountsByEnrollId),
    [patientLinks, visitDateRange, visitCountsByEnrollId]
  );
}

interface CarePlanConversionPanelProps {
  hasCarePlanImports: boolean;
  hasServiceDataImports: boolean;
  serviceDataRefreshKey: string;
  patientLinks: CarePlanPatientLink[];
  fetchSsdbServiceDateBounds: () => Promise<{
    from: string;
    to: string;
    error: string | null;
  }>;
  fetchVisitCountsByEnrollIdInDateRange: (
    startDate: string,
    endDate: string
  ) => Promise<{ visitCountsByEnrollId: Map<string, number>; error: string | null }>;
  fetchPatientServicesInDateRange: (
    enrollId: string,
    startDate: string,
    endDate: string
  ) => Promise<{
    services: ServiceDayService[];
    serviceDetailsByCalendarKey: Map<string, PatientSsdbServiceDetail>;
    error: string | null;
  }>;
  updatingRecordId: string | null;
  onToggleCarePlanCompleted: (recordId: string, completed: boolean) => void;
  onToggleEmarCompleted: (recordId: string, completed: boolean) => void;
}

export function CarePlanConversionPanel({
  hasCarePlanImports,
  hasServiceDataImports,
  serviceDataRefreshKey,
  patientLinks,
  fetchSsdbServiceDateBounds,
  fetchVisitCountsByEnrollIdInDateRange,
  fetchPatientServicesInDateRange,
  updatingRecordId,
  onToggleCarePlanCompleted,
  onToggleEmarCompleted,
}: CarePlanConversionPanelProps) {
  const [patientFilter, setPatientFilter] = useState<CarePlanPatientFilter>('all');
  const [selectedPatientOverview, setSelectedPatientOverview] =
    useState<CarePlanPatientLink | null>(null);
  const [search, setSearch] = useState('');
  const [pathwayCarePathFilter, setPathwayCarePathFilter] =
    useState<PathwayCarePathFilterSelection>(PATHWAY_CARE_PATH_FILTER_ALL);
  const [icLeadFilter, setIcLeadFilter] = useState<string[] | null>(null);
  const [episodeConversionStatusFilter, setEpisodeConversionStatusFilter] = useState<
    string[] | null
  >(null);
  const emptyVisitDateRange = useMemo<CarePlanDateRange>(() => ({ from: '', to: '' }), []);
  const [defaultVisitDateRange, setDefaultVisitDateRange] =
    useState<CarePlanDateRange>(emptyVisitDateRange);
  const [visitDateRange, setVisitDateRange] = useState<CarePlanDateRange>(emptyVisitDateRange);
  const [visitCountsByEnrollId, setVisitCountsByEnrollId] = useState<Map<string, number> | null>(
    () => new Map()
  );
  const [tableSort, setTableSort] = useState<{
    key: CarePlanTableSortKey;
    direction: SortDirection;
  } | null>(null);
  const [stackExpandMode, setStackExpandMode] = useState<'none' | 'main' | 'split'>('main');

  const toggleStackExpand = (target: 'main' | 'split') => {
    setStackExpandMode((prev) => (prev === target ? 'none' : target));
  };

  const renderStackExpandButton = (target: 'main' | 'split') => (
    <button
      type="button"
      className={[
        'hc-btn',
        'hc-epic-split-panel-expand',
        stackExpandMode === target
          ? 'hc-epic-split-panel-expand--collapse'
          : 'hc-epic-split-panel-expand--expand',
      ].join(' ')}
      aria-label={stackExpandMode === target ? 'Contract panel' : 'Expand panel'}
      onClick={() => toggleStackExpand(target)}
    />
  );

  useEffect(() => {
    if (!hasServiceDataImports) {
      setDefaultVisitDateRange(emptyVisitDateRange);
      setVisitDateRange(emptyVisitDateRange);
      setVisitCountsByEnrollId(new Map());
      return;
    }

    let cancelled = false;
    void fetchSsdbServiceDateBounds().then(({ from }) => {
      if (cancelled) return;
      const bounds = buildDefaultCarePlanVisitDateRange(from);
      setDefaultVisitDateRange(bounds);
      setVisitDateRange(bounds);
    });

    return () => {
      cancelled = true;
    };
  }, [
    hasServiceDataImports,
    serviceDataRefreshKey,
    fetchSsdbServiceDateBounds,
    emptyVisitDateRange,
  ]);

  useEffect(() => {
    if (!hasServiceDataImports || !visitDateRangeIsActive(visitDateRange)) {
      setVisitCountsByEnrollId(new Map());
      return;
    }

    let cancelled = false;
    setVisitCountsByEnrollId(null);
    void fetchVisitCountsByEnrollIdInDateRange(visitDateRange.from, visitDateRange.to).then(
      ({ visitCountsByEnrollId: counts }) => {
        if (!cancelled) {
          setVisitCountsByEnrollId(counts);
        }
      }
    );

    return () => {
      cancelled = true;
    };
  }, [
    hasServiceDataImports,
    serviceDataRefreshKey,
    visitDateRange,
    fetchVisitCountsByEnrollIdInDateRange,
  ]);

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
    (hasServiceDataImports &&
      !carePlanDateRangesEqual(visitDateRange, defaultVisitDateRange));

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
          visitDateRange,
          visitCountsByEnrollId,
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
      visitDateRange,
      visitCountsByEnrollId,
      icLeadOptions,
    ]
  );

  const pendingToolbarScopedLinks = useMemo(
    () => toolbarScopedLinks.filter((link) => !isCarePlanConversionRowComplete(link)),
    [toolbarScopedLinks]
  );

  const displaySummary = useMemo(
    () => summarizeCarePlanLinks(pendingToolbarScopedLinks),
    [pendingToolbarScopedLinks]
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
            visitDateRange,
            visitCountsByEnrollId,
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
      visitDateRange,
      visitCountsByEnrollId,
      icLeadOptions,
    ]
  );

  const pendingPatientLinks = useMemo(() => {
    const pending = filteredPatientLinks.filter(
      (link) => !isCarePlanConversionRowComplete(link)
    );
    return tableSort
      ? sortCarePlanPatientLinks(pending, tableSort, visitCountsByEnrollId)
      : pending;
  }, [filteredPatientLinks, tableSort, visitCountsByEnrollId]);

  const completedPatientLinks = useMemo(() => {
    const completed = filteredPatientLinks.filter((link) =>
      isCarePlanConversionRowComplete(link)
    );
    return tableSort
      ? sortCarePlanPatientLinks(completed, tableSort, visitCountsByEnrollId)
      : completed;
  }, [filteredPatientLinks, tableSort, visitCountsByEnrollId]);

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
    <div
      className={`hc-epic-table-stack hc-care-plan-conversion-stack${
        stackExpandMode === 'main' ? ' hc-epic-table-stack--main-expanded' : ''
      }${stackExpandMode === 'split' ? ' hc-epic-table-stack--split-expanded' : ''}`}
    >
      {selectedPatientOverview && (
        <PatientCareOverviewModal
          link={selectedPatientOverview}
          hasServiceDataImports={hasServiceDataImports}
          serviceDataRefreshKey={serviceDataRefreshKey}
          fetchPatientServicesInDateRange={fetchPatientServicesInDateRange}
          onClose={() => setSelectedPatientOverview(null)}
        />
      )}
      <section className="hc-epic-split-panel hc-epic-split-panel--main hc-care-plan-conversion">
        <h3 className="hc-epic-split-panel-title">
          <span className="hc-epic-split-panel-title-main">
            Pending Care Plan Conversion
            <span className="hc-epic-split-panel-count">{pendingPatientLinks.length}</span>
          </span>
          <span className="hc-epic-split-panel-title-actions">
            {renderPanelExportButton(
              pendingPatientLinks,
              'pending',
              'Export pending care plan conversions as Excel'
            )}
            {renderStackExpandButton('main')}
          </span>
        </h3>

        <div className="hc-progress-reconcile-summary hc-progress-reconcile-summary--care-plan">
        <CoverageStatButton
          filter="all"
          activeFilter={patientFilter}
          count={displaySummary.totalRecordCount}
          labelLine1="Episodes for"
          labelLine2="Care Planning"
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
          labelLine1="No Care"
          labelLine2="Plan Data"
          labelClassName="hc-care-plan-stat-label--no-data"
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
          {hasServiceDataImports && (
            <div
              className="hc-toolbar-field hc-toolbar-field--lvd"
              role="group"
              aria-label="Filter by SSDB service visit date range"
            >
              Visit
              <span className="hc-toolbar-lvd-range">
                <ToolbarLvdDateInput
                  value={visitDateRange.from}
                  max={visitDateRange.to || undefined}
                  ariaLabel="Visit from date"
                  onChange={(from) => setVisitDateRange((prev) => ({ ...prev, from }))}
                />
                <span className="hc-toolbar-lvd-range-sep" aria-hidden>
                  –
                </span>
                <ToolbarLvdDateInput
                  value={visitDateRange.to}
                  min={visitDateRange.from || undefined}
                  ariaLabel="Visit to date"
                  onChange={(to) => setVisitDateRange((prev) => ({ ...prev, to }))}
                />
              </span>
            </div>
          )}
          {hasActiveToolbarFilters && (
            <button
              type="button"
              className="hc-btn hc-btn-secondary hc-toolbar-clear"
              onClick={() => {
                setSearch('');
                setPathwayCarePathFilter(PATHWAY_CARE_PATH_FILTER_ALL);
                setIcLeadFilter(null);
                setEpisodeConversionStatusFilter(null);
                setVisitDateRange(defaultVisitDateRange);
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
          onOpenRows={setSelectedPatientOverview}
          onToggleCarePlanCompleted={onToggleCarePlanCompleted}
          onOpenEmarRows={setSelectedPatientOverview}
          onToggleEmarCompleted={onToggleEmarCompleted}
          visitCountsByEnrollId={visitCountsByEnrollId}
          hasServiceDataImports={hasServiceDataImports}
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
            <span className="hc-epic-split-panel-title-actions">
              {renderPanelExportButton(
                completedPatientLinks,
                'completed',
                'Export completed care plan conversions as Excel'
              )}
              {renderStackExpandButton('split')}
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
              onOpenRows={setSelectedPatientOverview}
              onToggleCarePlanCompleted={onToggleCarePlanCompleted}
              visitCountsByEnrollId={visitCountsByEnrollId}
              hasServiceDataImports={hasServiceDataImports}
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
  validatedRecordIds: ReadonlySet<string>,
  emarRows: import('../emar/types').EpicEmarRow[] = [],
  emarImportFilenames: Map<string, string> = new Map()
) {
  return useMemo(() => {
    const patientLinks = buildCarePlanPatientLinks(
      records,
      carePlanRows,
      validatedRecordIds,
      importFilenames,
      emarRows,
      emarImportFilenames
    );
    const summary = summarizeCarePlanLinks(patientLinks);

    return { patientLinks, summary };
  }, [records, carePlanRows, importFilenames, validatedRecordIds, emarRows, emarImportFilenames]);
}
