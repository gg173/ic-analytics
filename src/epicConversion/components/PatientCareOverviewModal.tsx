import { useEffect, useMemo } from 'react';
import { renderCarePlanContentKindBadge, renderCarePlanRowsListNeedsCell } from '../carePlan/formatTemplatedCarePlanText';
import { sortCarePlanRowsChronological } from '../carePlan/linkCarePlans';
import type { CarePlanPatientLink } from '../carePlan/types';
import { computeExpectedProgramEndDate } from '../ingest/ssdbReconciliation';
import { formatVhaIcLeadDisplay } from '../reconciliation/epicIclMatch';
import type { PatientSsdbServiceDetail, ServiceDayService } from '../serviceData/linkServiceDayCarePlans';
import { PatientServiceScheduleCalendar } from './PatientServiceScheduleCalendar';

interface PatientCareOverviewModalProps {
  link: CarePlanPatientLink;
  hasServiceDataImports: boolean;
  serviceDataRefreshKey: string;
  fetchPatientServicesInDateRange: (
    enrollId: string,
    startDate: string,
    endDate: string
  ) => Promise<{
    services: ServiceDayService[];
    serviceDetailsByCalendarKey: Map<string, PatientSsdbServiceDetail>;
    error: string | null;
  }>;
  onClose: () => void;
}

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

function formatDisplayDateTimeEst(value: string | null | undefined): string {
  if (!value?.trim()) return '—';
  const d = new Date(value.trim());
  if (Number.isNaN(d.getTime())) return value.trim();
  return d.toLocaleString('en-US', {
    timeZone: EASTERN_TIME_ZONE,
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
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

function ModalCloseButton({ onClose }: { onClose: () => void }) {
  return (
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
  );
}

export function PatientCareOverviewModal({
  link,
  hasServiceDataImports,
  serviceDataRefreshKey,
  fetchPatientServicesInDateRange,
  onClose,
}: PatientCareOverviewModalProps) {
  const sortedCarePlanRows = useMemo(
    () => sortCarePlanRowsChronological(link.carePlanRows),
    [link.carePlanRows]
  );
  const expectedProgramEndDate = useMemo(
    () => computeExpectedProgramEndDate(link.hospDcDate, link.pathway),
    [link.hospDcDate, link.pathway]
  );
  const icLeadDisplay = useMemo(() => formatVhaIcLeadDisplay(link.icLead), [link.icLead]);

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
        className="hc-modal hc-modal--patient-care-overview"
        role="dialog"
        aria-modal="true"
        aria-labelledby="patient-care-overview-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="hc-modal-header hc-modal-header--patient-care-overview">
          <h2 id="patient-care-overview-title">
            Care Plans, eMAR and Service Schedule for MRN {link.mrn}
          </h2>
          <ModalCloseButton onClose={onClose} />
        </header>

        <dl className="hc-care-plan-rows-list-summary hc-patient-care-overview-summary">
          <SummaryField label="Pathway" value={link.pathway} />
          <SummaryField label="Care Path" value={link.carePath} />
          <SummaryField label="IC Lead" value={icLeadDisplay} />
          <SummaryField label="Hosp DC Date" value={formatDisplayDate(link.hospDcDate)} />
          <SummaryField
            label="Expected Program End Date"
            value={formatDisplayDate(expectedProgramEndDate)}
          />
        </dl>

        <div className="hc-patient-care-overview-body">
          <div className="hc-patient-care-overview-left">
            <section className="hc-patient-care-overview-section">
              <h3 className="hc-patient-care-overview-section-title">Care Plan</h3>
              <div className="hc-table-wrap hc-care-plan-rows-list-table-wrap hc-patient-care-overview-table-wrap">
                {sortedCarePlanRows.length === 0 ? (
                  <p className="hc-muted hc-patient-care-overview-empty">No care plan data.</p>
                ) : (
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
                        <th>Date Saved</th>
                        <th>Client Needs / Goals</th>
                        <th>Service / Teaching Plan</th>
                        <th>Outcomes</th>
                        <th>Goal Met</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedCarePlanRows.map((row) => (
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
                )}
              </div>
            </section>

            <section
              className={`hc-patient-care-overview-section${
                link.emarRows.length === 0 ? ' hc-patient-care-overview-section--header-only' : ''
              }`}
            >
              <h3 className="hc-patient-care-overview-section-title">
                {link.emarRows.length === 0
                  ? 'eMAR: No medication data for this patient'
                  : 'eMAR'}
              </h3>
              {link.emarRows.length > 0 && (
                <div className="hc-table-wrap hc-care-plan-rows-list-table-wrap hc-patient-care-overview-table-wrap">
                  <table className="hc-table hc-table--grid hc-table--compact hc-table--care-plan-rows hc-table--care-plan-rows-list">
                    <thead>
                      <tr>
                        <th>Medication</th>
                        <th>Dose</th>
                        <th>Route</th>
                        <th>Frequency</th>
                        <th>Last admin</th>
                        <th>Order / dispensed</th>
                        <th>End date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {link.emarRows.map((row) => (
                        <tr key={row.id}>
                          <td>{row.medicationName?.trim() || '—'}</td>
                          <td>{row.dose?.trim() || '—'}</td>
                          <td>{row.route?.trim() || '—'}</td>
                          <td>{row.frequency?.trim() || '—'}</td>
                          <td>{formatDisplayDateTimeEst(row.lastAdminAt)}</td>
                          <td>{formatDisplayDate(row.orderOrDispensedDate)}</td>
                          <td>{formatDisplayDate(row.endDate)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>

          <div className="hc-patient-care-overview-right">
            <PatientServiceScheduleCalendar
              enrollId={link.enrollId}
              hasServiceDataImports={hasServiceDataImports}
              serviceDataRefreshKey={serviceDataRefreshKey}
              fetchPatientServicesInDateRange={fetchPatientServicesInDateRange}
              patientMrn={link.mrn}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
