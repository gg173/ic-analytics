import { useEffect, type ReactNode } from 'react';
import { carePlanContentKindLabel } from '../carePlan/classifyCarePlanContent';
import { renderClientNeedsGoalsContent } from '../carePlan/formatTemplatedCarePlanText';
import type { LinkedCarePlanRow } from '../carePlan/types';

function DocumentIcon() {
  return (
    <svg
      className="hc-care-plan-doc-icon"
      viewBox="0 0 32 32"
      width="1em"
      height="1em"
      aria-hidden
    >
      <path
        fill="currentColor"
        d="m25.7 9.3l-7-7c-.2-.2-.4-.3-.7-.3H8c-1.1 0-2 .9-2 2v24c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V10c0-.3-.1-.5-.3-.7M18 4.4l5.6 5.6H18zM24 28H8V4h8v6c0 1.1.9 2 2 2h6z"
      />
      <path fill="currentColor" d="M10 22h12v2H10zm0-6h12v2H10z" />
    </svg>
  );
}

export { DocumentIcon };

interface CarePlanRowDetailModalProps {
  row: LinkedCarePlanRow;
  mrn: string;
  onClose: () => void;
}

function DetailField({ label, value }: { label: string; value: string | null | undefined }) {
  const display = value?.trim() ? value : '—';
  return (
    <div className="hc-care-plan-detail-field">
      <dt>{label}</dt>
      <dd>{display}</dd>
    </div>
  );
}

function DetailTextField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="hc-care-plan-detail-field hc-care-plan-detail-field--text">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function CarePlanRowDetailModal({ row, mrn, onClose }: CarePlanRowDetailModalProps) {
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
        className="hc-modal hc-modal--care-plan-row"
        role="dialog"
        aria-modal="true"
        aria-labelledby="care-plan-row-detail-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="hc-modal-header">
          <h2 id="care-plan-row-detail-title">Care plan — MRN {mrn}</h2>
          <button
            type="button"
            className="hc-btn hc-btn-ghost hc-modal-close"
            aria-label="Close"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div className="hc-care-plan-detail-meta">
          <span className={`hc-care-plan-kind hc-care-plan-kind--${row.clientNeedsKind}`}>
            {carePlanContentKindLabel(row.clientNeedsKind)}
          </span>
          <span className="hc-care-plan-detail-source">{row.sourceFilename}</span>
        </div>

        <dl className="hc-care-plan-detail-fields">
          <DetailField label="BRN" value={row.brn} />
          <DetailField label="Client ID" value={row.clientId} />
          <DetailField label="Offer ID" value={row.offerId} />
          <DetailField label="GoldCare ID" value={row.goldcareId} />
          <DetailField label="Patient name" value={row.patientName} />
          <DetailField label="Date saved" value={row.dateSaved} />
          <DetailField label="Goal met" value={row.goalMet} />
          <DetailTextField label="Client needs / goals">
            {renderClientNeedsGoalsContent(row.clientNeedsGoals, row.clientNeedsKind)}
          </DetailTextField>
          <DetailTextField label="Service / teaching plan">
            {row.serviceTeachingPlan?.trim() ? row.serviceTeachingPlan : '—'}
          </DetailTextField>
          <DetailTextField label="Outcomes">
            {row.outcomes?.trim() ? row.outcomes : '—'}
          </DetailTextField>
        </dl>
      </div>
    </div>
  );
}
