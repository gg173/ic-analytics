import { useState } from 'react';
import { iclNamesMatch } from '../reconciliation/epicIclMatch';
import { epicPathwayMatchesVha } from '../reconciliation/epicPathwayMap';
import {
  formatMissingFromEpicResultSummary,
  normalizeMrnForMatch,
} from '../reconciliation/reconcileReportRows';
import { describeStatusDiscrepancy } from '../reconciliation/recordWorkflow';
import {
  RECONCILIATION_OUTCOME_LABELS,
  type ReconciliationDetailRow,
  type ReconciliationOutcomeFilter,
  type ReconciliationSummary,
} from '../reconciliation/types';

function mrnMatches(epicMrn: string, vhaMrn: string | null | undefined): boolean {
  if (!vhaMrn?.trim()) return false;
  return normalizeMrnForMatch(epicMrn) === normalizeMrnForMatch(vhaMrn);
}

function pathwayMatches(row: ReconciliationDetailRow): boolean {
  return epicPathwayMatchesVha(
    { pathway: row.pathway, epic_episode: row.epicEpisode },
    row.matchedPathway
  );
}

function iclMatches(
  epicIcl: string | null | undefined,
  vhaIcl: string | null | undefined
): boolean {
  if (!epicIcl?.trim() || !vhaIcl?.trim()) return false;
  return iclNamesMatch(epicIcl, vhaIcl);
}

function formatVhaMrn(vhaMrn: string | null | undefined): string {
  return vhaMrn?.trim() ? vhaMrn : '(Missing)';
}

function buildResultSummary(row: ReconciliationDetailRow): string {
  const epicMrn = row.mrn?.trim();
  const vhaMrn = row.matchedMrn?.trim();

  if (epicMrn && !vhaMrn) {
    return 'Patient Not in VHA System';
  }

  const parts: string[] = [];

  if (epicMrn && vhaMrn && !mrnMatches(row.mrn, row.matchedMrn)) {
    parts.push('MRN mismatch');
  }
  if (!pathwayMatches(row)) {
    parts.push('Pathway mismatch');
  }
  if (!iclMatches(row.icLead, row.matchedIcLead)) {
    parts.push('ICL mismatch');
  }
  if (row.outcome === 'status_discrepancy') {
    parts.push(describeStatusDiscrepancy(row.matchedWorkflowStatus));
  }
  if (row.outcome === 'missing_from_epic') {
    return formatMissingFromEpicResultSummary(row);
  }

  if (row.outcome === 'validated' || row.outcome === 'perfect') {
    return 'Validated';
  }

  return parts.length ? parts.join('; ') : '—';
}

function reconcileCellClass(base: string, affected: boolean): string {
  if (!affected) return base;
  return base ? `${base} hc-reconcile-cell--discrepancy` : 'hc-reconcile-cell--discrepancy';
}

function ReconcileCheckIcon({ pass }: { pass: boolean }) {
  return (
    <span
      className={`hc-reconcile-check ${pass ? 'hc-reconcile-check--pass' : 'hc-reconcile-check--fail'}`}
      aria-label={pass ? 'Match' : 'Mismatch'}
    >
      {pass ? '✓' : '✗'}
    </span>
  );
}

interface ReconcileStatButtonProps {
  filter: ReconciliationOutcomeFilter;
  activeFilter: ReconciliationOutcomeFilter;
  count: number;
  label: string;
  className: string;
  onOutcomeFilterChange: (filter: ReconciliationOutcomeFilter) => void;
}

function ReconcileStatButton({
  filter,
  activeFilter,
  count,
  label,
  className,
  onOutcomeFilterChange,
}: ReconcileStatButtonProps) {
  const active = activeFilter === filter;

  return (
    <button
      type="button"
      className={`hc-reconcile-stat ${className}${active ? ' hc-reconcile-stat--active' : ''}`}
      aria-pressed={active}
      onClick={() => onOutcomeFilterChange(active ? 'all' : filter)}
    >
      <strong>{count}</strong>
      <span>{label}</span>
    </button>
  );
}

interface ConversionDiscrepanciesPanelProps {
  hasEpicReports: boolean;
  summary: ReconciliationSummary | null;
  reconciliationDetails: ReconciliationDetailRow[];
  outcomeFilter: ReconciliationOutcomeFilter;
  onOutcomeFilterChange: (filter: ReconciliationOutcomeFilter) => void;
  onRecheck: () => Promise<{ error: string | null }>;
  rechecking?: boolean;
}

export function ConversionDiscrepanciesPanel({
  hasEpicReports,
  summary,
  reconciliationDetails,
  outcomeFilter,
  onOutcomeFilterChange,
  onRecheck,
  rechecking = false,
}: ConversionDiscrepanciesPanelProps) {
  const [recheckError, setRecheckError] = useState<string | null>(null);
  const rowCount = reconciliationDetails.length;

  const handleRecheck = async () => {
    setRecheckError(null);
    const result = await onRecheck();
    if (result.error) {
      setRecheckError(result.error);
    }
  };

  if (!hasEpicReports) {
    return (
      <section className="hc-epic-split-panel hc-epic-split-panel--main hc-conversion-discrepancies">
        <h3 className="hc-epic-split-panel-title">
          <span className="hc-epic-split-panel-title-main">
            Episode Validation
            <span className="hc-epic-split-panel-count">0</span>
          </span>
        </h3>
        <p className="hc-muted hc-epic-split-panel-empty">
          No Epic conversion report uploaded yet. Upload a report on the Import Data tab.
        </p>
      </section>
    );
  }

  return (
    <section className="hc-epic-split-panel hc-epic-split-panel--main hc-conversion-discrepancies">
        <h3 className="hc-epic-split-panel-title">
          <span className="hc-epic-split-panel-title-main">
            Episode Validation
            <span className="hc-epic-split-panel-count">{rowCount}</span>
          </span>
          <button
            type="button"
            className="hc-btn hc-btn-secondary hc-btn-sm"
            disabled={rechecking}
            aria-label={rechecking ? 'Rechecking validation' : 'Recheck validation'}
            onClick={() => void handleRecheck()}
          >
            {rechecking ? 'Rechecking…' : 'Recheck'}
          </button>
        </h3>

        {recheckError && <p className="hc-form-error hc-conversion-discrepancies-error">{recheckError}</p>}

        {summary && (
          <div className="hc-progress-reconcile-summary">
            <ReconcileStatButton
              filter="validated"
              activeFilter={outcomeFilter}
              count={summary.validated}
              label={RECONCILIATION_OUTCOME_LABELS.validated}
              className="hc-reconcile-stat--validated"
              onOutcomeFilterChange={onOutcomeFilterChange}
            />
            <ReconcileStatButton
              filter="status_discrepancy"
              activeFilter={outcomeFilter}
              count={summary.statusDiscrepancy}
              label={RECONCILIATION_OUTCOME_LABELS.status_discrepancy}
              className="hc-reconcile-stat--status-discrepancy"
              onOutcomeFilterChange={onOutcomeFilterChange}
            />
            <ReconcileStatButton
              filter="field_discrepancy"
              activeFilter={outcomeFilter}
              count={summary.fieldDiscrepancy}
              label={RECONCILIATION_OUTCOME_LABELS.field_discrepancy}
              className="hc-reconcile-stat--field-discrepancy"
              onOutcomeFilterChange={onOutcomeFilterChange}
            />
            <ReconcileStatButton
              filter="unmatched"
              activeFilter={outcomeFilter}
              count={summary.unmatched}
              label={RECONCILIATION_OUTCOME_LABELS.unmatched}
              className="hc-reconcile-stat--unmatched"
              onOutcomeFilterChange={onOutcomeFilterChange}
            />
            <ReconcileStatButton
              filter="missing_from_epic"
              activeFilter={outcomeFilter}
              count={summary.missingFromEpic}
              label={RECONCILIATION_OUTCOME_LABELS.missing_from_epic}
              className="hc-reconcile-stat--missing-from-epic"
              onOutcomeFilterChange={onOutcomeFilterChange}
            />
          </div>
        )}

        {rowCount === 0 ? (
          <p className="hc-muted hc-epic-split-panel-empty">
            {outcomeFilter === 'all'
              ? 'No reconciliation results yet. Upload an Epic report or run Recheck.'
              : 'No rows match the selected filter.'}
          </p>
        ) : (
          <div className="hc-table-wrap hc-table-wrap--wide hc-table-wrap--fill-main">
            <table className="hc-table hc-table--grid hc-table--reconcile-discrepancies">
              <colgroup>
                <col className="hc-reconcile-mrn-col" />
                <col className="hc-reconcile-mrn-col" />
                <col className="hc-reconcile-check-col" />
                <col className="hc-reconcile-pathway-col" />
                <col className="hc-reconcile-pathway-col" />
                <col className="hc-reconcile-check-col" />
                <col className="hc-reconcile-icl-col" />
                <col className="hc-reconcile-icl-col" />
                <col className="hc-reconcile-check-col" />
                <col className="hc-reconcile-result-col" />
              </colgroup>
              <thead>
                <tr>
                  <th colSpan={3} className="hc-reconcile-group-header">
                    MRN
                  </th>
                  <th colSpan={3} className="hc-reconcile-group-header">
                    Pathway
                  </th>
                  <th colSpan={3} className="hc-reconcile-group-header">
                    IC Lead
                  </th>
                  <th rowSpan={2} className="hc-reconcile-result-header">
                    Result
                  </th>
                </tr>
                <tr>
                  <th className="hc-reconcile-vha-col">VHA</th>
                  <th className="hc-reconcile-epic-col">Epic</th>
                  <th
                    className="hc-reconcile-check-col hc-reconcile-group-end"
                    aria-label="MRN check"
                  />
                  <th className="hc-reconcile-vha-col">VHA</th>
                  <th className="hc-reconcile-epic-col">Epic</th>
                  <th
                    className="hc-reconcile-check-col hc-reconcile-group-end"
                    aria-label="Pathway check"
                  />
                  <th className="hc-reconcile-icl-col hc-reconcile-vha-col">VHA</th>
                  <th className="hc-reconcile-icl-col hc-reconcile-epic-col">Epic</th>
                  <th
                    className="hc-reconcile-check-col hc-reconcile-group-end"
                    aria-label="IC Lead check"
                  />
                </tr>
              </thead>
              <tbody>
                {reconciliationDetails.map((row) => {
                  const mrnOk = mrnMatches(row.mrn, row.matchedMrn);
                  const pathwayOk = pathwayMatches(row);
                  const iclOk = iclMatches(row.icLead, row.matchedIcLead);
                  const statusAffected =
                    row.outcome === 'status_discrepancy' || row.outcome === 'missing_from_epic';

                  return (
                    <tr key={row.reportRowId}>
                      <td className={reconcileCellClass('hc-reconcile-vha-col', !mrnOk)}>
                        {formatVhaMrn(row.matchedMrn)}
                      </td>
                      <td className={reconcileCellClass('hc-reconcile-epic-col', !mrnOk)}>
                        {row.mrn || '—'}
                      </td>
                      <td
                        className={reconcileCellClass(
                          'hc-reconcile-check-col hc-reconcile-group-end',
                          !mrnOk
                        )}
                      >
                        <ReconcileCheckIcon pass={mrnOk} />
                      </td>
                      <td className={reconcileCellClass('hc-reconcile-vha-col', !pathwayOk)}>
                        {row.matchedPathway?.trim() ? row.matchedPathway : '—'}
                      </td>
                      <td className={reconcileCellClass('hc-reconcile-epic-col', !pathwayOk)}>
                        {row.pathway?.trim() ? row.pathway : (row.epicEpisode ?? '—')}
                      </td>
                      <td
                        className={reconcileCellClass(
                          'hc-reconcile-check-col hc-reconcile-group-end',
                          !pathwayOk
                        )}
                      >
                        <ReconcileCheckIcon pass={pathwayOk} />
                      </td>
                      <td
                        className={reconcileCellClass(
                          'hc-reconcile-icl-col hc-reconcile-vha-col',
                          !iclOk
                        )}
                      >
                        {row.matchedIcLead?.trim() ? row.matchedIcLead : '—'}
                      </td>
                      <td
                        className={reconcileCellClass(
                          'hc-reconcile-icl-col hc-reconcile-epic-col',
                          !iclOk
                        )}
                      >
                        {row.icLead?.trim() ? row.icLead : '—'}
                      </td>
                      <td
                        className={reconcileCellClass(
                          'hc-reconcile-check-col hc-reconcile-group-end',
                          !iclOk
                        )}
                      >
                        <ReconcileCheckIcon pass={iclOk} />
                      </td>
                      <td className={reconcileCellClass('', statusAffected)}>
                        {buildResultSummary(row)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
  );
}
