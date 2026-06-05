import { useEffect } from 'react';
import {
  formatServiceDaySrvDiscDisplay,
  formatSsdbServiceIngestStatusLabel,
  type PatientSsdbServiceDetail,
} from '../serviceData/linkServiceDayCarePlans';

const EASTERN_TIME_ZONE = 'America/New_York';

function formatDisplayDate(value: string | null | undefined): string {
  if (!value?.trim()) return '—';
  const d = new Date(`${value.trim()}T12:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    timeZone: EASTERN_TIME_ZONE,
  });
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

interface ServiceDayDetailModalProps {
  detail: PatientSsdbServiceDetail;
  mrn: string | null;
  onClose: () => void;
}

export function ServiceDayDetailModal({ detail, mrn, onClose }: ServiceDayDetailModalProps) {
  const visitType =
    formatServiceDaySrvDiscDisplay(detail.srvDiscipline, detail.srvDeliveryMode) ?? 'Service';

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onClose();
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

  return (
    <div className="hc-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="hc-modal hc-modal--service-day-detail"
        role="dialog"
        aria-modal="true"
        aria-labelledby="service-day-detail-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="hc-modal-header">
          <h2 id="service-day-detail-title">
            Service — {visitType}
            {mrn?.trim() ? ` · MRN ${mrn}` : ''}
          </h2>
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
          <span
            className={`hc-service-day-detail-status hc-service-day-detail-status--${detail.ingestStatus}`}
          >
            {formatSsdbServiceIngestStatusLabel(detail.ingestStatus)}
          </span>
        </div>

        <dl className="hc-care-plan-detail-fields">
          <DetailField label="Service date" value={formatDisplayDate(detail.srvDate)} />
          <DetailField label="Service date (PDD)" value={formatDisplayDate(detail.srvDatePdd)} />
          <DetailField label="Visit type" value={visitType} />
          <DetailField label="SRV discipline" value={detail.srvDiscipline} />
          <DetailField label="Delivery mode" value={detail.srvDeliveryMode} />
          <DetailField label="Pathway" value={detail.pathway} />
          <DetailField label="Care path" value={detail.carepath} />
          <DetailField label="Program" value={detail.program} />
          <DetailField label="SRV code" value={detail.srvCode} />
          <DetailField label="SRV code description" value={detail.srvCodeDescription} />
          <DetailField label="SRV status" value={detail.srvStatus} />
          <DetailField label="SRV Tx code(s)" value={detail.srvTxCodes} />
          <DetailField label="Provider ID" value={detail.srvProviderId} />
          <DetailField label="Provider designation" value={detail.srvProviderDesignation} />
          <DetailField label="Start time" value={detail.startTime} />
          <DetailField label="End time" value={detail.endTime} />
          <DetailField label="Worked duration" value={detail.workedDuration} />
        </dl>
      </div>
    </div>
  );
}
