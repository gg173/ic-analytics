import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  formatServiceDaySrvDiscDisplay,
  type PatientSsdbServiceDetail,
  type ServiceDayService,
} from '../serviceData/linkServiceDayCarePlans';
import { ServiceDayDetailModal } from './ServiceDayDetailModal';

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

function toIsoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function formatMonthYear(year: number, month: number): string {
  const d = new Date(year, month, 1);
  const monthLabel = d.toLocaleDateString('en-US', { month: 'short' });
  return `${monthLabel} ${year}`;
}

function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const d = new Date(year, month + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() };
}

function buildCalendarWeeks(year: number, month: number): Date[][] {
  const weeks: Date[][] = [];
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startOffset = (new Date(year, month, 1).getDay() + 6) % 7;
  let day = 1 - startOffset;
  let includedLastDay = false;

  while (!includedLastDay) {
    const week: Date[] = [];
    for (let col = 0; col < 7; col += 1) {
      week.push(new Date(year, month, day));
      day += 1;
    }
    weeks.push(week);
    if (week.some((d) => d.getMonth() === month && d.getDate() === daysInMonth)) {
      includedLastDay = true;
    }
  }

  return weeks;
}

function dateToIso(date: Date): string {
  return toIsoDate(date.getFullYear(), date.getMonth(), date.getDate());
}

function getCalendarGridDateRange(weeks: Date[][]): { start: string; end: string } {
  const firstDate = weeks[0]?.[0];
  const lastWeek = weeks[weeks.length - 1];
  const lastDate = lastWeek?.[lastWeek.length - 1];
  if (!firstDate || !lastDate) {
    return { start: '', end: '' };
  }
  return { start: dateToIso(firstDate), end: dateToIso(lastDate) };
}

function ChevronLeftIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M15 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

interface PatientServiceScheduleCalendarProps {
  enrollId: string | null;
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
  patientMrn?: string | null;
}

export function PatientServiceScheduleCalendar({
  enrollId,
  hasServiceDataImports,
  serviceDataRefreshKey,
  fetchPatientServicesInDateRange,
  patientMrn = null,
}: PatientServiceScheduleCalendarProps) {
  const today = useMemo(() => new Date(), []);
  const [visibleYear, setVisibleYear] = useState(today.getFullYear());
  const [visibleMonth, setVisibleMonth] = useState(today.getMonth());
  const [services, setServices] = useState<ServiceDayService[]>([]);
  const [serviceDetailsByCalendarKey, setServiceDetailsByCalendarKey] = useState<
    Map<string, PatientSsdbServiceDetail>
  >(() => new Map());
  const [selectedCalendarKey, setSelectedCalendarKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const weeks = useMemo(
    () => buildCalendarWeeks(visibleYear, visibleMonth),
    [visibleYear, visibleMonth]
  );
  const gridDateRange = useMemo(() => getCalendarGridDateRange(weeks), [weeks]);

  const servicesByDate = useMemo(() => {
    const byDate = new Map<string, ServiceDayService[]>();
    for (const service of services) {
      const existing = byDate.get(service.srvDate) ?? [];
      existing.push(service);
      byDate.set(service.srvDate, existing);
    }
    return byDate;
  }, [services]);

  useEffect(() => {
    if (!hasServiceDataImports || !enrollId?.trim()) {
      setServices([]);
      setServiceDetailsByCalendarKey(new Map());
      setSelectedCalendarKey(null);
      setError(null);
      setLoading(false);
      return undefined;
    }
    if (!gridDateRange.start || !gridDateRange.end) return undefined;

    let cancelled = false;
    setLoading(true);
    setError(null);

    void fetchPatientServicesInDateRange(enrollId, gridDateRange.start, gridDateRange.end).then(
      ({ services: fetchedServices, serviceDetailsByCalendarKey: fetchedDetails, error: fetchError }) => {
        if (cancelled) return;
        setServices(fetchedServices);
        setServiceDetailsByCalendarKey(fetchedDetails);
        setSelectedCalendarKey((previous) =>
          previous && fetchedDetails.has(previous) ? previous : null
        );
        setError(fetchError);
        setLoading(false);
      }
    );

    return () => {
      cancelled = true;
    };
  }, [
    enrollId,
    hasServiceDataImports,
    gridDateRange.start,
    gridDateRange.end,
    fetchPatientServicesInDateRange,
    serviceDataRefreshKey,
  ]);

  const previousMonth = useMemo(
    () => shiftMonth(visibleYear, visibleMonth, -1),
    [visibleYear, visibleMonth]
  );
  const nextMonth = useMemo(
    () => shiftMonth(visibleYear, visibleMonth, 1),
    [visibleYear, visibleMonth]
  );

  const monthLabel = formatMonthYear(visibleYear, visibleMonth);
  const todayIso = toIsoDate(today.getFullYear(), today.getMonth(), today.getDate());
  const selectedServiceDetail = selectedCalendarKey
    ? serviceDetailsByCalendarKey.get(selectedCalendarKey) ?? null
    : null;

  if (!hasServiceDataImports) {
    return (
      <div className="hc-patient-service-schedule-calendar hc-patient-service-schedule-calendar--empty">
        <p className="hc-muted">No SSDB service data uploaded yet.</p>
      </div>
    );
  }

  if (!enrollId?.trim()) {
    return (
      <div className="hc-patient-service-schedule-calendar hc-patient-service-schedule-calendar--empty">
        <p className="hc-muted">No enrolment linked for this patient.</p>
      </div>
    );
  }

  return (
    <div className="hc-patient-service-schedule-calendar" aria-label="Patient service schedule">
      <div className="hc-patient-service-schedule-calendar-header">
        <h3 className="hc-patient-care-overview-section-title">Service Schedule</h3>
        <div className="hc-patient-service-schedule-calendar-nav">
          <button
            type="button"
            className="hc-service-data-calendar-nav-btn"
            onClick={() => {
              setVisibleYear(previousMonth.year);
              setVisibleMonth(previousMonth.month);
            }}
            aria-label={`Previous month, ${formatMonthYear(previousMonth.year, previousMonth.month)}`}
          >
            <ChevronLeftIcon />
          </button>
          <span className="hc-service-data-calendar-month">{monthLabel}</span>
          <button
            type="button"
            className="hc-service-data-calendar-nav-btn"
            onClick={() => {
              setVisibleYear(nextMonth.year);
              setVisibleMonth(nextMonth.month);
            }}
            aria-label={`Next month, ${formatMonthYear(nextMonth.year, nextMonth.month)}`}
          >
            <ChevronRightIcon />
          </button>
        </div>
      </div>

      <div
        className="hc-service-data-calendar-grid hc-patient-service-schedule-calendar-grid"
        role="grid"
        aria-label={monthLabel}
        style={{ '--hc-service-data-calendar-week-rows': weeks.length } as CSSProperties}
      >
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} className="hc-service-data-calendar-dow" role="columnheader">
            {label}
          </div>
        ))}

        {weeks.flatMap((week, weekIndex) =>
          week.map((date, dayIndex) => {
            const isoDate = dateToIso(date);
            const dayServices = servicesByDate.get(isoDate) ?? [];
            const isToday = isoDate === todayIso;
            const isOutsideMonth = date.getMonth() !== visibleMonth;
            const hasChangeDetected = dayServices.some(
              (service) => service.ingestStatus === 'changed'
            );
            const cancellationCount = dayServices.filter(
              (service) => service.ingestStatus === 'vha_cancelled'
            ).length;

            return (
              <div
                key={`${isoDate}-${weekIndex}-${dayIndex}`}
                className={`hc-service-data-calendar-cell hc-patient-service-schedule-calendar-cell${
                  isToday ? ' hc-service-data-calendar-cell--today' : ''
                }${isOutsideMonth ? ' hc-service-data-calendar-cell--outside-month' : ''}`}
                role="gridcell"
                aria-label={`${date.toLocaleDateString('en-US', {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                })}, ${dayServices.length} service${dayServices.length === 1 ? '' : 's'}`}
              >
                <div className="hc-patient-service-schedule-calendar-day-num">{date.getDate()}</div>
                {loading ? (
                  <span className="hc-patient-service-schedule-calendar-loading" aria-hidden>
                    …
                  </span>
                ) : dayServices.length > 0 ? (
                  <ul className="hc-patient-service-schedule-calendar-services">
                    {dayServices.map((service) => {
                      const visitLabel =
                        formatServiceDaySrvDiscDisplay(
                          service.srvDiscipline,
                          service.srvDeliveryMode
                        ) ?? 'Service';

                      return (
                        <li key={service.calendarKey}>
                          <button
                            type="button"
                            className={`hc-patient-service-schedule-calendar-service${
                              service.ingestStatus === 'vha_cancelled'
                                ? ' hc-patient-service-schedule-calendar-service--cancelled'
                                : ''
                            }${
                              service.ingestStatus === 'changed'
                                ? ' hc-patient-service-schedule-calendar-service--changed'
                                : ''
                            }`}
                            onClick={() => setSelectedCalendarKey(service.calendarKey)}
                            aria-label={`View details for ${visitLabel} on ${date.toLocaleDateString(
                              'en-US',
                              {
                                weekday: 'long',
                                month: 'long',
                                day: 'numeric',
                                year: 'numeric',
                              }
                            )}`}
                          >
                            {visitLabel}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
                {(hasChangeDetected || cancellationCount > 0) && !loading ? (
                  <div className="hc-patient-service-schedule-calendar-flags" aria-hidden>
                    {hasChangeDetected ? (
                      <span className="hc-patient-service-schedule-calendar-flag hc-patient-service-schedule-calendar-flag--changed" />
                    ) : null}
                    {cancellationCount > 0 ? (
                      <span className="hc-patient-service-schedule-calendar-flag hc-patient-service-schedule-calendar-flag--cancelled" />
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>

      {error ? <p className="hc-form-error hc-patient-service-schedule-calendar-error">{error}</p> : null}

      {selectedServiceDetail ? (
        <ServiceDayDetailModal
          detail={selectedServiceDetail}
          mrn={patientMrn}
          onClose={() => setSelectedCalendarKey(null)}
        />
      ) : null}
    </div>
  );
}
