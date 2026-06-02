import { useEffect, type ReactNode } from 'react';
import { carePlanContentKindLabel } from '../carePlan/classifyCarePlanContent';
import { renderClientNeedsGoalsContent } from '../carePlan/formatTemplatedCarePlanText';
import type { LinkedCarePlanRow } from '../carePlan/types';

function AttachmentIcon() {
  return (
    <svg
      className="hc-care-plan-attach-icon"
      viewBox="0 0 16 16"
      width={14}
      height={14}
      aria-hidden
    >
      <path
        fill="currentColor"
        d="M11.5 1.5a3.5 3.5 0 0 0-4.95 0L2.79 5.26a4.75 4.75 0 0 0 6.72 6.72l4.24-4.24a.75.75 0 1 1 1.06 1.06l-4.24 4.24a6.25 6.25 0 1 1-8.84-8.84l3.76-3.76a5 5 0 0 1 7.07 7.07l-4.6 4.6a3.25 3.25 0 1 1-4.6-4.6l3.53-3.53a.75.75 0 1 1 1.06 1.06l-3.53 3.53a1.75 1.75 0 1 0 2.47 2.47l4.6-4.6a3.5 3.5 0 0 0-4.95-4.95Z"
      />
    </svg>
  );
}

export { AttachmentIcon };

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
          <DetailTextField label="Service / teaching plan" value={row.serviceTeachingPlan} />
          <DetailTextField label="Outcomes" value={row.outcomes} />
        </dl>
      </div>
    </div>
  );
}
