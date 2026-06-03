import { useMemo, useState } from 'react';
import { carePlanContentKindLabel } from '../carePlan/classifyCarePlanContent';
import {
  buildCarePlanPatientLinks,
  eligibilityReasonLabel,
  getLatestCarePlanRow,
  isCarePlanDateStale,
  isLvdOnOrAfterCarePlanToolbarMin,
  patientNeedsCarePlanUpdate,
  recordHasTemplatedCarePlan,
  summarizeCarePlanLinks,
} from '../carePlan/linkCarePlans';
import type { CarePlanContentKind } from '../carePlan/types';
import type {
  CarePlanLinkSummary,
  CarePlanPatientFilter,
  CarePlanPatientLink,
} from '../carePlan/types';

type CarePlanLvdFilter = 'all' | 'min_june_22';
import type { EpicConversionRecord } from '../types';
import { AttachmentIcon } from './CarePlanRowDetailModal';
import { CarePlanRowsListModal } from './CarePlanRowsListModal';
import { matchesMultiFilter, ToolbarMultiSelect } from './ToolbarMultiSelect';

function distinctLinkOptions(
  links: CarePlanPatientLink[],
  selector: (link: CarePlanPatientLink) => string | null
): string[] {
  const set = new Set<string>();
  for (const link of links) {
    const v = selector(link);
    if (v) set.add(v);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

function matchesCarePlanToolbarFilters(
  link: CarePlanPatientLink,
  search: string,
  pathwayFilter: string[] | null,
  carePathFilter: string[] | null,
  icLeadFilter: string[] | null,
  lvdFilter: CarePlanLvdFilter,
  pathwayOptions: readonly string[],
  carePathOptions: readonly string[],
  icLeadOptions: readonly string[]
): boolean {
  if (!matchesMultiFilter(pathwayFilter, link.pathway, pathwayOptions)) return false;
  if (!matchesMultiFilter(carePathFilter, link.carePath, carePathOptions)) return false;
  if (!matchesMultiFilter(icLeadFilter, link.icLead, icLeadOptions)) return false;
  if (lvdFilter === 'min_june_22' && !isLvdOnOrAfterCarePlanToolbarMin(link.lvd)) return false;
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
  updatingRecordId,
  onOpenRows,
  onToggleCarePlanCompleted,
}: {
  links: CarePlanPatientLink[];
  mode: 'pending' | 'completed';
  updatingRecordId: string | null;
  onOpenRows: (link: CarePlanPatientLink) => void;
  onToggleCarePlanCompleted: (recordId: string, completed: boolean) => void;
}) {
  const isPending = mode === 'pending';

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
            <th>Hospital DC Date</th>
            <th>Care Plan</th>
            <th>Latest Care Plan Date</th>
            <th>LVD</th>
            {isPending && <th>Episode Conversion Status</th>}
            <th>Care Plan Conversion Status</th>
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
  const [pathwayFilter, setPathwayFilter] = useState<string[] | null>(null);
  const [carePathFilter, setCarePathFilter] = useState<string[] | null>(null);
  const [icLeadFilter, setIcLeadFilter] = useState<string[] | null>(null);
  const [lvdFilter, setLvdFilter] = useState<CarePlanLvdFilter>('all');

  const pathwayOptions = useMemo(
    () => distinctLinkOptions(patientLinks, (link) => link.pathway),
    [patientLinks]
  );
  const carePathOptions = useMemo(() => {
    const set = new Set<string>();
    for (const link of patientLinks) {
      if (!matchesMultiFilter(pathwayFilter, link.pathway, pathwayOptions)) continue;
      if (link.carePath) set.add(link.carePath);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [patientLinks, pathwayFilter, pathwayOptions]);
  const icLeadOptions = useMemo(() => {
    const set = new Set<string>();
    for (const link of patientLinks) {
      if (!matchesMultiFilter(pathwayFilter, link.pathway, pathwayOptions)) continue;
      if (link.icLead) set.add(link.icLead);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [patientLinks, pathwayFilter, pathwayOptions]);

  const hasActiveToolbarFilters =
    search.trim() !== '' ||
    pathwayFilter !== null ||
    carePathFilter !== null ||
    icLeadFilter !== null ||
    lvdFilter !== 'all';

  const toolbarScopedLinks = useMemo(
    () =>
      patientLinks.filter((link) =>
        matchesCarePlanToolbarFilters(
          link,
          search,
          pathwayFilter,
          carePathFilter,
          icLeadFilter,
          lvdFilter,
          pathwayOptions,
          carePathOptions,
          icLeadOptions
        )
      ),
    [
      patientLinks,
      search,
      pathwayFilter,
      carePathFilter,
      icLeadFilter,
      lvdFilter,
      pathwayOptions,
      carePathOptions,
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
            pathwayFilter,
            carePathFilter,
            icLeadFilter,
            lvdFilter,
            pathwayOptions,
            carePathOptions,
            icLeadOptions
          )
        ),
    [
      patientLinks,
      patientFilter,
      search,
      pathwayFilter,
      carePathFilter,
      icLeadFilter,
      lvdFilter,
      pathwayOptions,
      carePathOptions,
      icLeadOptions,
    ]
  );

  const pendingPatientLinks = useMemo(
    () => filteredPatientLinks.filter((link) => !link.carePlanCompletedAt),
    [filteredPatientLinks]
  );

  const completedPatientLinks = useMemo(
    () => filteredPatientLinks.filter((link) => link.carePlanCompletedAt),
    [filteredPatientLinks]
  );

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
          <label className="hc-search">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search MRN, Pathway, IC Lead"
              aria-label="Search MRN, Pathway, IC Lead"
            />
          </label>
          <div className="hc-toolbar-field hc-toolbar-field--pathway">
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
          <div
            className="hc-toolbar-field hc-toolbar-field--lvd"
            role="group"
            aria-label="Filter by LVD"
          >
            LVD
            <span className="hc-toolbar-field-lvd-control">
              <label className="hc-toolbar-field-lvd-option">
                <input
                  type="radio"
                  name="care-plan-lvd-filter"
                  value="all"
                  checked={lvdFilter === 'all'}
                  onChange={() => setLvdFilter('all')}
                />
                All
              </label>
              <label className="hc-toolbar-field-lvd-option">
                <input
                  type="radio"
                  name="care-plan-lvd-filter"
                  value="min_june_22"
                  checked={lvdFilter === 'min_june_22'}
                  onChange={() => setLvdFilter('min_june_22')}
                />
                ≥ 22 Jun 2026
              </label>
            </span>
          </div>
          {hasActiveToolbarFilters && (
            <button
              type="button"
              className="hc-btn hc-btn-secondary hc-toolbar-clear"
              onClick={() => {
                setSearch('');
                setPathwayFilter(null);
                setCarePathFilter(null);
                setIcLeadFilter(null);
                setLvdFilter('all');
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
