import { useEffect, useMemo } from 'react';
import { renderCarePlanContentKindBadge, renderCarePlanRowsListNeedsCell } from '../carePlan/formatTemplatedCarePlanText';
import { sortCarePlanRowsChronological } from '../carePlan/linkCarePlans';
import type { LinkedCarePlanRow } from '../carePlan/types';
import { computeExpectedProgramEndDate } from '../ingest/ssdbReconciliation';
import { formatVhaIcLeadDisplay } from '../reconciliation/epicIclMatch';

interface CarePlanRowsListModalProps {
  mrn: string;
  rows: LinkedCarePlanRow[];
  pathway: string | null;
  carePath: string | null;
  icLead: string | null;
  hospDcDate: string | null;
  onClose: () => void;
}

function formatDisplayDate(value: string | null | undefined): string {
  if (!value?.trim()) return '—';
  const d = new Date(`${value.trim()}T12:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
  });
}

function SummaryField({ label, value }: { label: string; value: string | null | undefined }) {
  const display = value?.trim() ? value : '—';
  return (
    <div className="hc-care-plan-detail-field">
      <dt>{label}</dt>
      <dd>{display}</dd>
    </div>
  );
}

export function CarePlanRowsListModal({
  mrn,
  rows,
  pathway,
  carePath,
  icLead,
  hospDcDate,
  onClose,
}: CarePlanRowsListModalProps) {
  const sortedRows = useMemo(() => sortCarePlanRowsChronological(rows), [rows]);
  const expectedProgramEndDate = useMemo(
    () => computeExpectedProgramEndDate(hospDcDate, pathway),
    [hospDcDate, pathway]
  );
  const icLeadDisplay = useMemo(() => formatVhaIcLeadDisplay(icLead), [icLead]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="hc-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="hc-modal hc-modal--care-plan-rows-list"
        role="dialog"
        aria-modal="true"
        aria-labelledby="care-plan-rows-list-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="hc-modal-header">
          <h2 id="care-plan-rows-list-title">Care plans — MRN {mrn}</h2>
          <button
            type="button"
            className="hc-btn hc-btn-ghost hc-modal-close"
            aria-label="Close"
            onClick={onClose}
          >
            <span className="hc-modal-close-glyph" aria-hidden>
              <svg viewBox="0 0 24 24" focusable="false">
                <path
                  d="M6 6l12 12M18 6L6 18"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </span>
          </button>
        </header>

        <dl className="hc-care-plan-rows-list-summary">
          <SummaryField label="Pathway" value={pathway} />
          <SummaryField label="Care Path" value={carePath} />
          <SummaryField label="IC Lead" value={icLeadDisplay} />
          <SummaryField label="Hosp DC Date" value={formatDisplayDate(hospDcDate)} />
          <SummaryField
            label="Expected Program End Date"
            value={formatDisplayDate(expectedProgramEndDate)}
          />
        </dl>

        <div className="hc-table-wrap hc-care-plan-rows-list-table-wrap">
          <table className="hc-table hc-table--grid hc-table--compact hc-table--care-plan-rows hc-table--care-plan-rows-list">
            <colgroup>
              <col className="hc-care-plan-rows-list-col-date" />
              <col className="hc-care-plan-rows-list-col-needs" />
              <col className="hc-care-plan-rows-list-col-service" />
              <col className="hc-care-plan-rows-list-col-outcomes" />
              <col className="hc-care-plan-rows-list-col-goal-met" />
            </colgroup>
            <thead>
              <tr>
                <th>Date saved</th>
                <th>Client needs / goals</th>
                <th>Service / teaching plan</th>
                <th>Outcomes</th>
                <th>Goal met</th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row) => (
                <tr key={row.id}>
                  <td className="hc-care-plan-rows-list-date">
                    <div className="hc-care-plan-rows-list-date-inner">
                      <span>{row.dateSaved?.trim() || '—'}</span>
                      {renderCarePlanContentKindBadge(row.clientNeedsKind)}
                    </div>
                  </td>
                  <td className="hc-care-plan-rows-list-needs">
                    {renderCarePlanRowsListNeedsCell(
                      row.clientNeedsGoals,
                      row.clientNeedsKind
                    )}
                  </td>
                  <td className="hc-care-plan-rows-list-text">
                    {row.serviceTeachingPlan?.trim() || '—'}
                  </td>
                  <td className="hc-care-plan-rows-list-text">
                    {row.outcomes?.trim() || '—'}
                  </td>
                  <td>{row.goalMet?.trim() || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
