import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import {
  downloadServiceDayPatientsXlsx,
  type ServiceDayPatientExportRow,
} from '../export/buildServiceDayPatientsXlsx';
import { formatVhaIcLeadDisplay } from '../reconciliation/epicIclMatch';
import {
  formatServiceDaySrvDiscDisplay,
  type ServiceDayPatient,
  type ServiceDayService,
} from '../serviceData/linkServiceDayCarePlans';
import { TableExportButton } from './TableExportButton';
import { ToolbarMultiSelect } from './ToolbarMultiSelect';

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

/** Union of visible grid range and selected dates so off-month selections keep data. */
function getDataFetchDateRange(
  gridDateRange: { start: string; end: string },
  selectedDates: Set<string>
): { start: string; end: string } {
  if (!gridDateRange.start || !gridDateRange.end) {
    return gridDateRange;
  }
  if (selectedDates.size === 0) {
    return gridDateRange;
  }

  const sortedSelection = [...selectedDates].sort((a, b) => a.localeCompare(b));
  const selectionStart = sortedSelection[0];
  const selectionEnd = sortedSelection[sortedSelection.length - 1];

  return {
    start: selectionStart < gridDateRange.start ? selectionStart : gridDateRange.start,
    end: selectionEnd > gridDateRange.end ? selectionEnd : gridDateRange.end,
  };
}

function formatWeekDateRange(week: Date[]): string {
  const monday = week[0];
  const sunday = week[6];
  const mondayLabel = monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const sundayLabel = sunday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${mondayLabel} - ${sundayLabel}`;
}

function formatDayLabelDay(date: Date): string {
  return String(date.getDate()).padStart(2, '0');
}

function formatDayLabelMonth(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short' });
}

function getSelectableWeekIsoDates(
  week: Date[],
  serviceCountsByDate: Map<string, number>,
  patientCountsByDate: Map<string, number>
): string[] {
  return week
    .map(dateToIso)
    .filter((isoDate) => {
      const serviceCount = serviceCountsByDate.get(isoDate) ?? 0;
      const patientCount = patientCountsByDate.get(isoDate) ?? 0;
      return serviceCount > 0 || patientCount > 0;
    });
}

function getVisibleMonthServiceCount(
  weeks: Date[][],
  visibleMonth: number,
  serviceCountsByDate: Map<string, number>
): number {
  let total = 0;
  for (const week of weeks) {
    for (const date of week) {
      if (date.getMonth() !== visibleMonth) continue;
      total += serviceCountsByDate.get(dateToIso(date)) ?? 0;
    }
  }
  return total;
}

function getSelectableMonthIsoDates(
  weeks: Date[][],
  visibleMonth: number,
  serviceCountsByDate: Map<string, number>,
  patientCountsByDate: Map<string, number>
): string[] {
  const isoDates: string[] = [];
  for (const week of weeks) {
    for (const date of week) {
      if (date.getMonth() !== visibleMonth) continue;
      const isoDate = dateToIso(date);
      const serviceCount = serviceCountsByDate.get(isoDate) ?? 0;
      const patientCount = patientCountsByDate.get(isoDate) ?? 0;
      if (serviceCount > 0 || patientCount > 0) {
        isoDates.push(isoDate);
      }
    }
  }
  return isoDates;
}

function areAllWeekDaysSelected(selectableIsoDates: string[], selectedDates: Set<string>): boolean {
  return (
    selectableIsoDates.length > 0 &&
    selectableIsoDates.every((isoDate) => selectedDates.has(isoDate))
  );
}

function areSomeWeekDaysSelected(selectableIsoDates: string[], selectedDates: Set<string>): boolean {
  return selectableIsoDates.some((isoDate) => selectedDates.has(isoDate));
}

function collectDayTemplatedPercents(
  patientCountsByDate: Map<string, number>,
  templatedCarePlanPercentByDate: Map<string, number>
): number[] {
  const values: number[] = [];
  for (const [date, patientCount] of patientCountsByDate) {
    if (patientCount <= 0) continue;
    const percent = templatedCarePlanPercentByDate.get(date);
    if (percent != null) values.push(percent);
  }
  return values;
}

/** Percentile rank among peer days: 0 = lowest, 1 = highest (ties share midpoint rank). */
function templatedPercentileRank(value: number, allValues: number[]): number {
  const n = allValues.length;
  if (n <= 1) return 0.5;

  let less = 0;
  let equal = 0;
  for (const v of allValues) {
    if (v < value) less += 1;
    else if (v === value) equal += 1;
  }

  return (less + (equal - 1) / 2) / (n - 1);
}

function templatedPercentHeatmapStyle(percent: number, allDayPercents: number[]): CSSProperties {
  if (percent >= 100) {
    return {
      backgroundColor: 'hsl(134, 72%, 42%)',
      color: '#fff',
      borderColor: 'hsl(134, 68%, 34%)',
    };
  }

  if (percent < 85) {
    return {
      backgroundColor: 'hsl(0, 58%, 42%)',
      color: '#fff',
      borderColor: 'hsl(0, 52%, 34%)',
    };
  }

  if (percent > 95) {
    return {
      backgroundColor: 'hsl(120, 65%, 82%)',
      color: 'hsl(120, 55%, 28%)',
      borderColor: 'hsl(120, 50%, 55%)',
    };
  }

  if (percent >= 90) {
    return {
      backgroundColor: 'hsl(72, 65%, 82%)',
      color: 'hsl(72, 55%, 28%)',
      borderColor: 'hsl(72, 50%, 55%)',
    };
  }

  const rank = templatedPercentileRank(percent, allDayPercents);
  const hue = rank >= 0.9 ? 120 : rank < 0.4 ? 0 : 45;
  return {
    backgroundColor: `hsl(${hue}, 65%, 82%)`,
    color: `hsl(${hue}, 55%, 28%)`,
    borderColor: `hsl(${hue}, 50%, 55%)`,
  };
}

function TemplatedCarePlanPercentCircle({
  percent,
  templatedCount,
  patientCount,
  loading,
  allDayPercents,
}: {
  percent: number | undefined;
  templatedCount: number | undefined;
  patientCount: number;
  loading: boolean;
  allDayPercents: number[];
}) {
  if (loading || percent == null || templatedCount == null) {
    return (
      <div
        className="hc-service-data-calendar-templated-badge hc-service-data-calendar-templated-badge--loading"
        aria-hidden
      >
        …
      </div>
    );
  }

  return (
    <div
      className="hc-service-data-calendar-templated-badge"
      style={templatedPercentHeatmapStyle(percent, allDayPercents)}
      aria-label={`${templatedCount} of ${patientCount} patients with templated care plan (${percent}%)`}
    >
      <span className="hc-service-data-calendar-templated-badge-label" aria-hidden>
        % of Pts with CP Template
      </span>
      <span className="hc-service-data-calendar-templated-badge-content">
        <span className="hc-service-data-calendar-templated-badge-percent">{percent}%</span>
        <span className="hc-service-data-calendar-templated-badge-fraction">
          {templatedCount}/{patientCount}
        </span>
      </span>
    </div>
  );
}

function CalendarDaySummaryBadge({
  date,
  count,
  loading,
  showCheckbox,
  checked,
  onCheckedChange,
}: {
  date: Date;
  count: number;
  loading: boolean;
  showCheckbox: boolean;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  const showVisits = loading || count > 0;
  const selectAriaLabel = `Select ${date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })}`;

  return (
    <div
      className={`hc-service-data-calendar-day-summary-badge${
        loading ? ' hc-service-data-calendar-day-summary-badge--loading' : ''
      }`}
    >
      <div className="hc-service-data-calendar-day-summary-main">
        <div className="hc-service-data-calendar-day-num">
          <span className="hc-service-data-calendar-day-num-day">{formatDayLabelDay(date)}</span>
          <span className="hc-service-data-calendar-day-num-month">{formatDayLabelMonth(date)}</span>
        </div>
        {showVisits ? (
          <>
            <span className="hc-service-data-calendar-day-summary-sep" aria-hidden />
            <span
              className="hc-service-data-calendar-visit-count"
              aria-label={loading ? undefined : `${count} visit${count === 1 ? '' : 's'}`}
            >
              {loading ? '…' : `${count} visit${count === 1 ? '' : 's'}`}
            </span>
          </>
        ) : null}
      </div>
      {showCheckbox ? (
        <input
          type="checkbox"
          className="hc-service-data-calendar-day-checkbox"
          checked={checked}
          onChange={(event) => onCheckedChange(event.target.checked)}
          aria-label={selectAriaLabel}
        />
      ) : null}
    </div>
  );
}

function CalendarMonthSelectAllBadge({
  monthLabel,
  count,
  loading,
  showCheckbox,
  allMonthDaysSelected,
  someMonthDaysSelected,
  onCheckedChange,
}: {
  monthLabel: string;
  count: number;
  loading: boolean;
  showCheckbox: boolean;
  allMonthDaysSelected: boolean;
  someMonthDaysSelected: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  const showVisits = loading || count > 0;
  const checkboxRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (checkboxRef.current) {
      checkboxRef.current.indeterminate = someMonthDaysSelected && !allMonthDaysSelected;
    }
  }, [allMonthDaysSelected, someMonthDaysSelected]);

  return (
    <div
      className={`hc-service-data-calendar-day-summary-badge hc-service-data-calendar-week-summary-badge hc-service-data-calendar-month-summary-badge${
        loading ? ' hc-service-data-calendar-day-summary-badge--loading' : ''
      }`}
    >
      <div className="hc-service-data-calendar-day-summary-main">
        <div className="hc-service-data-calendar-day-num">
          <span className="hc-service-data-calendar-week-label-heading">Select All Days</span>
          <span className="hc-service-data-calendar-week-label-dates">in Month</span>
        </div>
        {showVisits ? (
          <>
            <span className="hc-service-data-calendar-day-summary-sep" aria-hidden />
            <span
              className="hc-service-data-calendar-visit-count"
              aria-label={loading ? undefined : `${count} visit${count === 1 ? '' : 's'}`}
            >
              {loading ? '…' : `${count} visit${count === 1 ? '' : 's'}`}
            </span>
          </>
        ) : null}
      </div>
      {showCheckbox ? (
        <input
          ref={checkboxRef}
          type="checkbox"
          className="hc-service-data-calendar-day-checkbox"
          checked={allMonthDaysSelected}
          onChange={(event) => onCheckedChange(event.target.checked)}
          aria-label={`Select all days in ${monthLabel} with service data`}
        />
      ) : null}
    </div>
  );
}

function CalendarWeekSummaryBadge({
  weekDateRange,
  count,
  loading,
  showCheckbox,
  allWeekDaysSelected,
  someWeekDaysSelected,
  onCheckedChange,
}: {
  weekDateRange: string;
  count: number;
  loading: boolean;
  showCheckbox: boolean;
  allWeekDaysSelected: boolean;
  someWeekDaysSelected: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  const showVisits = loading || count > 0;
  const checkboxRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (checkboxRef.current) {
      checkboxRef.current.indeterminate = someWeekDaysSelected && !allWeekDaysSelected;
    }
  }, [allWeekDaysSelected, someWeekDaysSelected]);

  return (
    <div
      className={`hc-service-data-calendar-day-summary-badge hc-service-data-calendar-week-summary-badge${
        loading ? ' hc-service-data-calendar-day-summary-badge--loading' : ''
      }`}
    >
      <div className="hc-service-data-calendar-day-summary-main">
        <div className="hc-service-data-calendar-day-num">
          <span className="hc-service-data-calendar-week-label-heading">Week of</span>
          <span className="hc-service-data-calendar-week-label-dates">{weekDateRange}</span>
        </div>
        {showVisits ? (
          <>
            <span className="hc-service-data-calendar-day-summary-sep" aria-hidden />
            <span
              className="hc-service-data-calendar-visit-count"
              aria-label={loading ? undefined : `${count} visit${count === 1 ? '' : 's'}`}
            >
              {loading ? '…' : `${count} visit${count === 1 ? '' : 's'}`}
            </span>
          </>
        ) : null}
      </div>
      {showCheckbox ? (
        <input
          ref={checkboxRef}
          type="checkbox"
          className="hc-service-data-calendar-day-checkbox"
          checked={allWeekDaysSelected}
          onChange={(event) => onCheckedChange(event.target.checked)}
          aria-label={`Select week of ${weekDateRange}`}
        />
      ) : null}
    </div>
  );
}

function getSelectionBorderClasses(
  weekIndex: number,
  dayIndex: number,
  week: Date[],
  weeks: Date[][],
  selectedDates: Set<string>
): string | null {
  const isoDate = dateToIso(week[dayIndex]);
  if (!selectedDates.has(isoDate)) return null;

  const topSelected =
    weekIndex > 0 && selectedDates.has(dateToIso(weeks[weekIndex - 1][dayIndex]));
  const bottomSelected =
    weekIndex < weeks.length - 1 &&
    selectedDates.has(dateToIso(weeks[weekIndex + 1][dayIndex]));
  const leftSelected = dayIndex > 0 && selectedDates.has(dateToIso(week[dayIndex - 1]));
  const rightSelected = dayIndex < 6 && selectedDates.has(dateToIso(week[dayIndex + 1]));

  const showTop = !topSelected;
  const showRight = !rightSelected;
  const showBottom = !bottomSelected;
  const showLeft = !leftSelected;

  const classes = ['hc-service-data-calendar-selection-border'];
  if (showTop) classes.push('hc-service-data-calendar-selection-border--top');
  if (showRight) classes.push('hc-service-data-calendar-selection-border--right');
  if (showBottom) classes.push('hc-service-data-calendar-selection-border--bottom');
  if (showLeft) classes.push('hc-service-data-calendar-selection-border--left');
  if (showTop && showLeft) classes.push('hc-service-data-calendar-selection-border--corner-tl');
  if (showTop && showRight) classes.push('hc-service-data-calendar-selection-border--corner-tr');
  if (showBottom && showLeft) classes.push('hc-service-data-calendar-selection-border--corner-bl');
  if (showBottom && showRight) classes.push('hc-service-data-calendar-selection-border--corner-br');
  return classes.join(' ');
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

interface ServiceDataCalendarProps {
  fetchDailyCountsForDateRange: (
    startDate: string,
    endDate: string
  ) => Promise<{
    serviceCountsByDate: Map<string, number>;
    patientCountsByDate: Map<string, number>;
    weekServiceCountsByWeekStart: Map<string, number>;
    weekPatientCountsByWeekStart: Map<string, number>;
    templatedCarePlanPercentByDate: Map<string, number>;
    templatedCarePlanPercentByWeekStart: Map<string, number>;
    templatedCarePlanCountByDate: Map<string, number>;
    templatedCarePlanCountByWeekStart: Map<string, number>;
    patientsByDate: Map<string, ServiceDayPatient[]>;
    services: ServiceDayService[];
    error: string | null;
  }>;
  fetchMonthHasServices: (
    year: number,
    month: number
  ) => Promise<{ hasServices: boolean; error: string | null }>;
  hasCarePlanImports?: boolean;
  refreshKey?: string;
  search: string;
  onSearchChange: (value: string) => void;
  icLeadFilter: string[] | null;
  onIcLeadFilterChange: (value: string[] | null) => void;
  icLeadOptions: readonly string[];
}

export function ServiceDataCalendar({
  fetchDailyCountsForDateRange,
  fetchMonthHasServices,
  hasCarePlanImports = false,
  refreshKey = '',
  search,
  onSearchChange,
  icLeadFilter,
  onIcLeadFilterChange,
  icLeadOptions,
}: ServiceDataCalendarProps) {
  const today = useMemo(() => new Date(), []);
  const [visibleYear, setVisibleYear] = useState(today.getFullYear());
  const [visibleMonth, setVisibleMonth] = useState(today.getMonth());
  const [serviceCountsByDate, setServiceCountsByDate] = useState<Map<string, number>>(() => new Map());
  const [patientCountsByDate, setPatientCountsByDate] = useState<Map<string, number>>(() => new Map());
  const [weekServiceCountsByWeekStart, setWeekServiceCountsByWeekStart] = useState<Map<string, number>>(
    () => new Map()
  );
  const [weekPatientCountsByWeekStart, setWeekPatientCountsByWeekStart] = useState<Map<string, number>>(
    () => new Map()
  );
  const [templatedCarePlanPercentByDate, setTemplatedCarePlanPercentByDate] = useState<
    Map<string, number>
  >(() => new Map());
  const [templatedCarePlanPercentByWeekStart, setTemplatedCarePlanPercentByWeekStart] = useState<
    Map<string, number>
  >(() => new Map());
  const [templatedCarePlanCountByDate, setTemplatedCarePlanCountByDate] = useState<
    Map<string, number>
  >(() => new Map());
  const [templatedCarePlanCountByWeekStart, setTemplatedCarePlanCountByWeekStart] = useState<
    Map<string, number>
  >(() => new Map());
  const [patientsByDate, setPatientsByDate] = useState<Map<string, ServiceDayPatient[]>>(
    () => new Map()
  );
  const [services, setServices] = useState<ServiceDayService[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [prevMonthHasServices, setPrevMonthHasServices] = useState<boolean | null>(null);
  const [nextMonthHasServices, setNextMonthHasServices] = useState<boolean | null>(null);
  const [selectedDates, setSelectedDates] = useState<Set<string>>(() => new Set());

  const toggleDaySelection = useCallback((isoDate: string, checked: boolean) => {
    setSelectedDates((previous) => {
      const next = new Set(previous);
      if (checked) {
        next.add(isoDate);
      } else {
        next.delete(isoDate);
      }
      return next;
    });
  }, []);

  const toggleWeekSelection = useCallback((isoDates: string[], checked: boolean) => {
    setSelectedDates((previous) => {
      const next = new Set(previous);
      for (const isoDate of isoDates) {
        if (checked) {
          next.add(isoDate);
        } else {
          next.delete(isoDate);
        }
      }
      return next;
    });
  }, []);

  const previousMonth = useMemo(
    () => shiftMonth(visibleYear, visibleMonth, -1),
    [visibleYear, visibleMonth]
  );
  const nextMonth = useMemo(
    () => shiftMonth(visibleYear, visibleMonth, 1),
    [visibleYear, visibleMonth]
  );

  const weeks = useMemo(
    () => buildCalendarWeeks(visibleYear, visibleMonth),
    [visibleYear, visibleMonth]
  );
  const gridDateRange = useMemo(() => getCalendarGridDateRange(weeks), [weeks]);
  const dataFetchDateRange = useMemo(
    () => getDataFetchDateRange(gridDateRange, selectedDates),
    [gridDateRange, selectedDates]
  );
  const sortedSelectedDates = useMemo(
    () => [...selectedDates].sort((a, b) => a.localeCompare(b)),
    [selectedDates]
  );

  const templatedDayPercents = useMemo(
    () => collectDayTemplatedPercents(patientCountsByDate, templatedCarePlanPercentByDate),
    [patientCountsByDate, templatedCarePlanPercentByDate]
  );

  const selectableMonthIsoDates = useMemo(
    () =>
      getSelectableMonthIsoDates(
        weeks,
        visibleMonth,
        serviceCountsByDate,
        patientCountsByDate
      ),
    [weeks, visibleMonth, serviceCountsByDate, patientCountsByDate]
  );
  const allMonthDaysSelected = areAllWeekDaysSelected(selectableMonthIsoDates, selectedDates);
  const someMonthDaysSelected = areSomeWeekDaysSelected(selectableMonthIsoDates, selectedDates);
  const hasMonthSelectableDays = selectableMonthIsoDates.length > 0;
  const monthServiceCount = useMemo(
    () => getVisibleMonthServiceCount(weeks, visibleMonth, serviceCountsByDate),
    [weeks, visibleMonth, serviceCountsByDate]
  );

  useEffect(() => {
    let cancelled = false;
    if (!dataFetchDateRange.start || !dataFetchDateRange.end) return undefined;

    setLoading(true);
    setError(null);

    void fetchDailyCountsForDateRange(dataFetchDateRange.start, dataFetchDateRange.end).then(
      ({
        serviceCountsByDate: services,
        patientCountsByDate: patients,
        weekServiceCountsByWeekStart: weekServices,
        weekPatientCountsByWeekStart: weekPatients,
        templatedCarePlanPercentByDate: templatedPercents,
        templatedCarePlanPercentByWeekStart: weekTemplatedPercents,
        templatedCarePlanCountByDate: templatedCounts,
        templatedCarePlanCountByWeekStart: weekTemplatedCounts,
        patientsByDate: dayPatients,
        services: dayServices,
        error: fetchError,
      }) => {
        if (cancelled) return;
        setServiceCountsByDate(services);
        setPatientCountsByDate(patients);
        setWeekServiceCountsByWeekStart(weekServices);
        setWeekPatientCountsByWeekStart(weekPatients);
        setTemplatedCarePlanPercentByDate(templatedPercents);
        setTemplatedCarePlanPercentByWeekStart(weekTemplatedPercents);
        setTemplatedCarePlanCountByDate(templatedCounts);
        setTemplatedCarePlanCountByWeekStart(weekTemplatedCounts);
        setPatientsByDate(dayPatients);
        setServices(dayServices);
        setError(fetchError);
        setLoading(false);
      }
    );

    return () => {
      cancelled = true;
    };
  }, [fetchDailyCountsForDateRange, dataFetchDateRange.start, dataFetchDateRange.end, refreshKey]);

  useEffect(() => {
    let cancelled = false;

    void Promise.all([
      fetchMonthHasServices(previousMonth.year, previousMonth.month),
      fetchMonthHasServices(nextMonth.year, nextMonth.month),
    ]).then(([previous, next]) => {
      if (cancelled) return;
      setPrevMonthHasServices(previous.hasServices);
      setNextMonthHasServices(next.hasServices);
    });

    return () => {
      cancelled = true;
    };
  }, [fetchMonthHasServices, previousMonth, nextMonth, refreshKey]);

  const goToPreviousMonth = () => {
    if (prevMonthHasServices !== true) return;
    setVisibleYear(previousMonth.year);
    setVisibleMonth(previousMonth.month);
  };

  const goToNextMonth = () => {
    if (nextMonthHasServices !== true) return;
    setVisibleYear(nextMonth.year);
    setVisibleMonth(nextMonth.month);
  };

  const monthLabel = formatMonthYear(visibleYear, visibleMonth);
  const previousMonthLabel = formatMonthYear(previousMonth.year, previousMonth.month);
  const nextMonthLabel = formatMonthYear(nextMonth.year, nextMonth.month);
  const todayIso = toIsoDate(today.getFullYear(), today.getMonth(), today.getDate());
  const hasSelection = selectedDates.size > 0;

  return (
    <div
      className={`hc-service-data-layout${
        hasSelection ? ' hc-service-data-layout--has-selection' : ''
      }`}
    >
    <div className="hc-service-data-calendar" aria-label="SSDB service data calendar">
      <div className="hc-service-data-calendar-nav">
        <div
          className="hc-toolbar hc-service-data-calendar-nav-filters hc-service-data-calendar-nav-filters--start"
          aria-hidden
        />
        <div className="hc-service-data-calendar-nav-center">
          <button
            type="button"
            className="hc-service-data-calendar-nav-btn"
            onClick={goToPreviousMonth}
            disabled={prevMonthHasServices === false}
            aria-label={`Previous month, ${previousMonthLabel}`}
          >
            <ChevronLeftIcon />
          </button>
          <h2 className="hc-service-data-calendar-month">{monthLabel}</h2>
          <button
            type="button"
            className="hc-service-data-calendar-nav-btn"
            onClick={goToNextMonth}
            disabled={nextMonthHasServices === false}
            aria-label={`Next month, ${nextMonthLabel}`}
          >
            <ChevronRightIcon />
          </button>
        </div>
        <div className="hc-toolbar hc-service-data-calendar-nav-filters hc-service-data-calendar-nav-filters--end">
          <label className="hc-search">
            <input
              type="search"
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Search MRN, Pathway, IC Lead"
              aria-label="Search MRN, Pathway, IC Lead"
            />
          </label>
          <div className="hc-toolbar-field">
            IC Lead
            <ToolbarMultiSelect
              options={icLeadOptions}
              selected={icLeadFilter}
              onChange={onIcLeadFilterChange}
              ariaLabel="Filter by IC lead"
              maxLabelsBeforeCount={1}
            />
          </div>
        </div>
      </div>

      <div
        className="hc-service-data-calendar-grid"
        role="grid"
        aria-label={monthLabel}
        style={{ '--hc-service-data-calendar-week-rows': weeks.length } as CSSProperties}
      >
        <div
          className="hc-service-data-calendar-dow hc-service-data-calendar-dow--gutter"
          role="columnheader"
          aria-label={
            hasMonthSelectableDays
              ? `Select all days in ${monthLabel} with service data`
              : undefined
          }
        >
          <div className="hc-service-data-calendar-day-header">
            <div className="hc-service-data-calendar-day-header-top">
              <CalendarMonthSelectAllBadge
                monthLabel={monthLabel}
                count={monthServiceCount}
                loading={loading}
                showCheckbox={hasMonthSelectableDays}
                allMonthDaysSelected={allMonthDaysSelected}
                someMonthDaysSelected={someMonthDaysSelected}
                onCheckedChange={(checked) => toggleWeekSelection(selectableMonthIsoDates, checked)}
              />
            </div>
          </div>
        </div>
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} className="hc-service-data-calendar-dow" role="columnheader">
            {label}
          </div>
        ))}

        {weeks.flatMap((week, weekIndex) => {
          const weekStartIso = dateToIso(week[0]);
          const weekServiceCount = weekServiceCountsByWeekStart.get(weekStartIso) ?? 0;
          const weekPatientCount = weekPatientCountsByWeekStart.get(weekStartIso) ?? 0;
          const weekDateRange = formatWeekDateRange(week);
          const weekRangeLabel = `Week of ${weekDateRange}`;
          const selectableWeekIsoDates = getSelectableWeekIsoDates(
            week,
            serviceCountsByDate,
            patientCountsByDate
          );
          const allWeekDaysSelected = areAllWeekDaysSelected(selectableWeekIsoDates, selectedDates);
          const someWeekDaysSelected = areSomeWeekDaysSelected(selectableWeekIsoDates, selectedDates);
          const hasWeekData = weekServiceCount > 0 || weekPatientCount > 0;
          const weekTemplatedCarePlanPercent =
            templatedCarePlanPercentByWeekStart.get(weekStartIso);
          const weekTemplatedCarePlanCount =
            templatedCarePlanCountByWeekStart.get(weekStartIso);
          return [
          <div
            key={`gutter-${weekIndex}`}
            className="hc-service-data-calendar-cell hc-service-data-calendar-cell--gutter"
            role="gridcell"
            aria-label={`${weekRangeLabel}, ${weekServiceCount} unique service${
              weekServiceCount === 1 ? '' : 's'
            }, ${weekPatientCount} unique patient${weekPatientCount === 1 ? '' : 's'}${
              hasCarePlanImports && weekPatientCount > 0 && weekTemplatedCarePlanPercent != null
                ? `, ${weekTemplatedCarePlanPercent}% with templated care plan`
                : ''
            }`}
          >
            <div className="hc-service-data-calendar-day-header">
              <div className="hc-service-data-calendar-day-header-top">
                <CalendarWeekSummaryBadge
                  weekDateRange={weekDateRange}
                  count={weekServiceCount}
                  loading={loading}
                  showCheckbox={hasWeekData}
                  allWeekDaysSelected={allWeekDaysSelected}
                  someWeekDaysSelected={someWeekDaysSelected}
                  onCheckedChange={(checked) =>
                    toggleWeekSelection(selectableWeekIsoDates, checked)
                  }
                />
              </div>
            </div>
            {hasWeekData && hasCarePlanImports && weekPatientCount > 0 ? (
              <div className="hc-service-data-calendar-day-stats">
                <div className="hc-service-data-calendar-day-body">
                  <TemplatedCarePlanPercentCircle
                    percent={weekTemplatedCarePlanPercent}
                    templatedCount={weekTemplatedCarePlanCount}
                    patientCount={weekPatientCount}
                    loading={loading}
                    allDayPercents={templatedDayPercents}
                  />
                </div>
              </div>
            ) : null}
          </div>,
          ...week.map((date, dayIndex) => {
            const isoDate = dateToIso(date);
            const serviceCount = serviceCountsByDate.get(isoDate) ?? 0;
            const patientCount = patientCountsByDate.get(isoDate) ?? 0;
            const isToday = isoDate === todayIso;
            const isOutsideMonth = date.getMonth() !== visibleMonth;
            const hasDayData = serviceCount > 0 || patientCount > 0;
            const isSelected = selectedDates.has(isoDate);
            const templatedCarePlanPercent = templatedCarePlanPercentByDate.get(isoDate);
            const templatedCarePlanCount = templatedCarePlanCountByDate.get(isoDate);
            const selectionBorderClasses = isSelected
              ? getSelectionBorderClasses(weekIndex, dayIndex, week, weeks, selectedDates)
              : null;

            return (
              <div
                key={`${isoDate}-${weekIndex}-${dayIndex}`}
                className={`hc-service-data-calendar-cell${
                  isToday ? ' hc-service-data-calendar-cell--today' : ''
                }${isOutsideMonth ? ' hc-service-data-calendar-cell--outside-month' : ''}${
                  isSelected ? ' hc-service-data-calendar-cell--selected' : ''
                }`}
                role="gridcell"
                aria-label={`${date.toLocaleDateString('en-US', {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                })}, ${serviceCount} service row${serviceCount === 1 ? '' : 's'}, ${patientCount} patient${
                  patientCount === 1 ? '' : 's'
                }${
                  hasCarePlanImports && patientCount > 0 && templatedCarePlanPercent != null
                    ? `, ${templatedCarePlanPercent}% with templated care plan`
                    : ''
                }`}
              >
                {selectionBorderClasses ? <div className={selectionBorderClasses} aria-hidden /> : null}
                <div className="hc-service-data-calendar-day-header">
                  <div className="hc-service-data-calendar-day-header-top">
                    <CalendarDaySummaryBadge
                      date={date}
                      count={serviceCount}
                      loading={loading}
                      showCheckbox={hasDayData}
                      checked={selectedDates.has(isoDate)}
                      onCheckedChange={(checked) => toggleDaySelection(isoDate, checked)}
                    />
                  </div>
                </div>
                {hasDayData && hasCarePlanImports && patientCount > 0 ? (
                  <div className="hc-service-data-calendar-day-stats">
                    <div className="hc-service-data-calendar-day-body">
                      <TemplatedCarePlanPercentCircle
                        percent={templatedCarePlanPercent}
                        templatedCount={templatedCarePlanCount}
                        patientCount={patientCount}
                        loading={loading}
                        allDayPercents={templatedDayPercents}
                      />
                    </div>
                  </div>
                ) : null}
              </div>
            );
          }),
        ];
        })}
      </div>

      {error ? <p className="hc-form-error hc-service-data-calendar-error">{error}</p> : null}
    </div>
    {hasSelection ? (
      <ServiceDataSelectionPanel
        sortedSelectedDates={sortedSelectedDates}
        serviceCountsByDate={serviceCountsByDate}
        patientsByDate={patientsByDate}
        services={services}
        hasCarePlanImports={hasCarePlanImports}
        loading={loading}
      />
    ) : null}
    </div>
  );
}

function CarePlanTemplateStatusIcon({ hasTemplatedCarePlan }: { hasTemplatedCarePlan: boolean }) {
  return (
    <span
      className={`hc-reconcile-check ${
        hasTemplatedCarePlan ? 'hc-reconcile-check--pass' : 'hc-reconcile-check--fail'
      }`}
      aria-label={hasTemplatedCarePlan ? 'CP template' : 'No CP template'}
    >
      {hasTemplatedCarePlan ? '✓' : '✗'}
    </span>
  );
}

type ServiceDayPatientSortKey = 'cp' | 'mrn' | 'pathway' | 'icLead';
type ServiceDayPatientSortDirection = 'asc' | 'desc';

function dedupeServiceDayPatients(patients: ServiceDayPatient[]): ServiceDayPatient[] {
  const byEnrollId = new Map<string, ServiceDayPatient>();
  for (const patient of patients) {
    const existing = byEnrollId.get(patient.enrollId);
    if (!existing) {
      byEnrollId.set(patient.enrollId, patient);
      continue;
    }
    if (patient.hasTemplatedCarePlan && !existing.hasTemplatedCarePlan) {
      byEnrollId.set(patient.enrollId, { ...existing, hasTemplatedCarePlan: true });
    }
  }
  return [...byEnrollId.values()];
}

function sortServiceDayPatients(
  patients: ServiceDayPatient[],
  sort: { key: ServiceDayPatientSortKey; direction: ServiceDayPatientSortDirection } | null
): ServiceDayPatient[] {
  if (!sort) return patients;

  const direction = sort.direction === 'asc' ? 1 : -1;
  return [...patients].sort((a, b) => {
    let cmp = 0;
    switch (sort.key) {
      case 'cp':
        cmp = Number(a.hasTemplatedCarePlan) - Number(b.hasTemplatedCarePlan);
        break;
      case 'mrn':
        cmp = (a.mrn ?? '').localeCompare(b.mrn ?? '', undefined, { sensitivity: 'base' });
        break;
      case 'pathway':
        cmp = (a.pathway ?? '').localeCompare(b.pathway ?? '', undefined, { sensitivity: 'base' });
        break;
      case 'icLead':
        cmp = (a.icLead ?? '').localeCompare(b.icLead ?? '', undefined, { sensitivity: 'base' });
        break;
    }
    if (cmp === 0) return a.enrollId.localeCompare(b.enrollId) * direction;
    return cmp * direction;
  });
}

function ServiceDayPatientsTable({
  patients,
  hasCarePlanImports,
  missingCpTemplateOnly,
  loading,
}: {
  patients: ServiceDayPatient[];
  hasCarePlanImports: boolean;
  missingCpTemplateOnly: boolean;
  loading: boolean;
}) {
  const [tableSort, setTableSort] = useState<{
    key: ServiceDayPatientSortKey;
    direction: ServiceDayPatientSortDirection;
  } | null>(null);

  const sortedPatients = useMemo(() => {
    const filtered =
      missingCpTemplateOnly && hasCarePlanImports
        ? patients.filter((patient) => !patient.hasTemplatedCarePlan)
        : patients;
    return sortServiceDayPatients(filtered, tableSort);
  }, [patients, missingCpTemplateOnly, hasCarePlanImports, tableSort]);

  const toggleTableSort = useCallback((key: ServiceDayPatientSortKey) => {
    setTableSort((previous) => {
      if (previous?.key === key) {
        return previous.direction === 'asc' ? { key, direction: 'desc' } : null;
      }
      return { key, direction: 'asc' };
    });
  }, []);

  const renderSortableHeader = (label: string, key: ServiceDayPatientSortKey, className?: string) => {
    const active = tableSort?.key === key;
    const direction = active ? tableSort.direction : null;
    return (
      <th scope="col" className={className}>
        <button
          type="button"
          className={`hc-table-sort${direction ? ` hc-table-sort--${direction}` : ''}`}
          aria-sort={direction ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}
          onClick={() => toggleTableSort(key)}
        >
          {label}
          <span className="hc-table-sort-indicator" aria-hidden />
        </button>
      </th>
    );
  };

  return (
    <div className="hc-service-data-selection-panel-table-wrap">
      <table
        className="hc-service-data-selection-panel-table"
        aria-label="Patients for selected dates"
      >
        <colgroup>
          {hasCarePlanImports ? <col className="hc-service-data-selection-panel-table-cp-col" /> : null}
          <col className="hc-service-data-selection-panel-table-mrn-col" />
          <col className="hc-service-data-selection-panel-table-pathway-col" />
          <col className="hc-service-data-selection-panel-table-ic-lead-col" />
        </colgroup>
        <thead>
          <tr>
            {hasCarePlanImports
              ? renderSortableHeader('CP', 'cp', 'hc-service-data-selection-panel-table-cp-col')
              : null}
            {renderSortableHeader('MRN', 'mrn', 'hc-service-data-selection-panel-table-mrn-col')}
            {renderSortableHeader('Pathway', 'pathway', 'hc-service-data-selection-panel-table-pathway-col')}
            {renderSortableHeader('IC Lead', 'icLead', 'hc-service-data-selection-panel-table-ic-lead-col')}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td
                colSpan={hasCarePlanImports ? 4 : 3}
                className="hc-service-data-selection-panel-table-loading"
              >
                …
              </td>
            </tr>
          ) : sortedPatients.length === 0 ? (
            <tr>
              <td
                colSpan={hasCarePlanImports ? 4 : 3}
                className="hc-service-data-selection-panel-table-empty"
              >
                No patients missing CP template
              </td>
            </tr>
          ) : (
            sortedPatients.map((patient) => (
              <tr key={patient.enrollId}>
                {hasCarePlanImports ? (
                  <td className="hc-service-data-selection-panel-table-cp-col">
                    <CarePlanTemplateStatusIcon
                      hasTemplatedCarePlan={patient.hasTemplatedCarePlan}
                    />
                  </td>
                ) : null}
                <td className="hc-service-data-selection-panel-table-mrn-col">
                  {patient.mrn ?? '—'}
                </td>
                <td className="hc-service-data-selection-panel-table-pathway-col">
                  {patient.pathway ?? '—'}
                </td>
                <td className="hc-service-data-selection-panel-table-ic-lead-col">
                  {formatVhaIcLeadDisplay(patient.icLead) ?? '—'}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

type ServiceDayServiceSortKey = 'cp' | 'mrn' | 'date' | 'srvDisc';
type ServiceDayServiceSortDirection = 'asc' | 'desc';

function sortServiceDayServices(
  services: ServiceDayService[],
  sort: { key: ServiceDayServiceSortKey; direction: ServiceDayServiceSortDirection } | null
): ServiceDayService[] {
  if (!sort) return services;

  const direction = sort.direction === 'asc' ? 1 : -1;
  return [...services].sort((a, b) => {
    let cmp = 0;
    switch (sort.key) {
      case 'cp':
        cmp = Number(a.hasTemplatedCarePlan) - Number(b.hasTemplatedCarePlan);
        break;
      case 'mrn':
        cmp = (a.mrn ?? '').localeCompare(b.mrn ?? '', undefined, { sensitivity: 'base' });
        break;
      case 'date':
        cmp = a.srvDate.localeCompare(b.srvDate);
        break;
      case 'srvDisc': {
        const aDisc =
          formatServiceDaySrvDiscDisplay(a.srvDiscipline, a.srvDeliveryMode) ?? '';
        const bDisc =
          formatServiceDaySrvDiscDisplay(b.srvDiscipline, b.srvDeliveryMode) ?? '';
        cmp = aDisc.localeCompare(bDisc, undefined, { sensitivity: 'base' });
        break;
      }
    }
    if (cmp === 0) return a.calendarKey.localeCompare(b.calendarKey) * direction;
    return cmp * direction;
  });
}

function ServiceDayServicesTable({
  services,
  hasCarePlanImports,
  missingCpTemplateOnly,
  loading,
}: {
  services: ServiceDayService[];
  hasCarePlanImports: boolean;
  missingCpTemplateOnly: boolean;
  loading: boolean;
}) {
  const [tableSort, setTableSort] = useState<{
    key: ServiceDayServiceSortKey;
    direction: ServiceDayServiceSortDirection;
  } | null>(null);

  const sortedServices = useMemo(() => {
    const filtered =
      missingCpTemplateOnly && hasCarePlanImports
        ? services.filter((service) => !service.hasTemplatedCarePlan)
        : services;
    return sortServiceDayServices(filtered, tableSort);
  }, [services, missingCpTemplateOnly, hasCarePlanImports, tableSort]);

  const toggleTableSort = useCallback((key: ServiceDayServiceSortKey) => {
    setTableSort((previous) => {
      if (previous?.key === key) {
        return previous.direction === 'asc' ? { key, direction: 'desc' } : null;
      }
      return { key, direction: 'asc' };
    });
  }, []);

  const renderSortableHeader = (label: string, key: ServiceDayServiceSortKey, className?: string) => {
    const active = tableSort?.key === key;
    const direction = active ? tableSort.direction : null;
    return (
      <th scope="col" className={className}>
        <button
          type="button"
          className={`hc-table-sort${direction ? ` hc-table-sort--${direction}` : ''}`}
          aria-sort={direction ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}
          onClick={() => toggleTableSort(key)}
        >
          {label}
          <span className="hc-table-sort-indicator" aria-hidden />
        </button>
      </th>
    );
  };

  const colSpan = hasCarePlanImports ? 4 : 3;

  return (
    <div className="hc-service-data-selection-panel-table-wrap">
      <table
        className="hc-service-data-selection-panel-table hc-service-data-selection-panel-table--services"
        aria-label="Services for selected dates"
      >
        <colgroup>
          {hasCarePlanImports ? <col className="hc-service-data-selection-panel-table-cp-col" /> : null}
          <col className="hc-service-data-selection-panel-table-mrn-col" />
          <col className="hc-service-data-selection-panel-table-date-col" />
          <col className="hc-service-data-selection-panel-table-srv-disc-col" />
        </colgroup>
        <thead>
          <tr>
            {hasCarePlanImports
              ? renderSortableHeader('CP', 'cp', 'hc-service-data-selection-panel-table-cp-col')
              : null}
            {renderSortableHeader('MRN', 'mrn', 'hc-service-data-selection-panel-table-mrn-col')}
            {renderSortableHeader('DATE', 'date', 'hc-service-data-selection-panel-table-date-col')}
            {renderSortableHeader(
              'SRV DISC',
              'srvDisc',
              'hc-service-data-selection-panel-table-srv-disc-col'
            )}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={colSpan} className="hc-service-data-selection-panel-table-loading">
                …
              </td>
            </tr>
          ) : sortedServices.length === 0 ? (
            <tr>
              <td colSpan={colSpan} className="hc-service-data-selection-panel-table-empty">
                {missingCpTemplateOnly && hasCarePlanImports
                  ? 'No services missing CP template'
                  : 'No services for selected dates'}
              </td>
            </tr>
          ) : (
            sortedServices.map((service) => (
              <tr key={service.calendarKey}>
                {hasCarePlanImports ? (
                  <td className="hc-service-data-selection-panel-table-cp-col">
                    <CarePlanTemplateStatusIcon
                      hasTemplatedCarePlan={service.hasTemplatedCarePlan}
                    />
                  </td>
                ) : null}
                <td className="hc-service-data-selection-panel-table-mrn-col">
                  {service.mrn ?? '—'}
                </td>
                <td className="hc-service-data-selection-panel-table-date-col">
                  {formatSelectionPanelDayLabel(service.srvDate)}
                </td>
                <td className="hc-service-data-selection-panel-table-srv-disc-col">
                  {formatServiceDaySrvDiscDisplay(
                    service.srvDiscipline,
                    service.srvDeliveryMode
                  ) ?? '—'}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function formatSelectionPanelDayLabel(isoDate: string): string {
  const date = new Date(`${isoDate}T12:00:00`);
  const month = date.toLocaleDateString('en-US', { month: 'short' });
  return `${month} ${date.getDate()}`;
}

function formatSelectionDateRangeTitle(sortedIsoDates: string[]): string {
  const count = sortedIsoDates.length;
  if (count === 0) return 'No days selected';
  const start = formatSelectionPanelDayLabel(sortedIsoDates[0]);
  const end = formatSelectionPanelDayLabel(sortedIsoDates[count - 1]);
  const dayWord = count === 1 ? 'day' : 'days';
  return `${start} - ${end} (${count} ${dayWord})`;
}

type SelectionPanelTab = 'patients' | 'services';

function ServiceDataSelectionPanel({
  sortedSelectedDates,
  serviceCountsByDate,
  patientsByDate,
  services,
  hasCarePlanImports,
  loading,
}: {
  /** All checked dates, including days not shown on the current calendar month. */
  sortedSelectedDates: string[];
  serviceCountsByDate: Map<string, number>;
  patientsByDate: Map<string, ServiceDayPatient[]>;
  services: ServiceDayService[];
  hasCarePlanImports: boolean;
  loading: boolean;
}) {
  const selectionTitle = useMemo(
    () => formatSelectionDateRangeTitle(sortedSelectedDates),
    [sortedSelectedDates]
  );
  const [activeTab, setActiveTab] = useState<SelectionPanelTab>('patients');
  const [missingCpTemplateOnly, setMissingCpTemplateOnly] = useState(false);
  const showMissingCpFilter = hasCarePlanImports;
  const filterActive = showMissingCpFilter && missingCpTemplateOnly;
  const selectedDateSet = useMemo(() => new Set(sortedSelectedDates), [sortedSelectedDates]);

  const consolidatedPatients = useMemo(() => {
    const patients: ServiceDayPatient[] = [];
    for (const isoDate of sortedSelectedDates) {
      patients.push(...(patientsByDate.get(isoDate) ?? []));
    }
    return sortServiceDayPatients(dedupeServiceDayPatients(patients), null);
  }, [sortedSelectedDates, patientsByDate]);

  const totalServiceCount = useMemo(() => {
    let total = 0;
    for (const isoDate of sortedSelectedDates) {
      total += serviceCountsByDate.get(isoDate) ?? 0;
    }
    return total;
  }, [sortedSelectedDates, serviceCountsByDate]);

  const missingCpCount = useMemo(
    () => consolidatedPatients.filter((patient) => !patient.hasTemplatedCarePlan).length,
    [consolidatedPatients]
  );

  const consolidatedServices = useMemo(() => {
    return services.filter((service) => selectedDateSet.has(service.srvDate));
  }, [services, selectedDateSet]);

  const exportRows = useMemo((): ServiceDayPatientExportRow[] => {
    const earliestDateByEnrollId = new Map<string, string>();
    for (const isoDate of sortedSelectedDates) {
      for (const patient of patientsByDate.get(isoDate) ?? []) {
        if (!earliestDateByEnrollId.has(patient.enrollId)) {
          earliestDateByEnrollId.set(patient.enrollId, isoDate);
        }
      }
    }

    const patients = filterActive
      ? consolidatedPatients.filter((patient) => !patient.hasTemplatedCarePlan)
      : consolidatedPatients;

    return patients.map((patient) => ({
      ...patient,
      serviceDate: earliestDateByEnrollId.get(patient.enrollId) ?? sortedSelectedDates[0] ?? '',
    }));
  }, [sortedSelectedDates, patientsByDate, consolidatedPatients, filterActive]);

  const handleExport = useCallback(() => {
    const dateStamp = new Date().toISOString().slice(0, 10);
    const rangePart =
      sortedSelectedDates.length === 1
        ? sortedSelectedDates[0]
        : `${sortedSelectedDates[0]}_to_${sortedSelectedDates[sortedSelectedDates.length - 1]}`;
    downloadServiceDayPatientsXlsx(exportRows, `service-day-patients-${rangePart}-${dateStamp}.xlsx`, {
      includeCpTemplate: hasCarePlanImports,
    });
  }, [exportRows, sortedSelectedDates, hasCarePlanImports]);

  return (
    <aside className="hc-service-data-selection-panel" aria-label="Selected service dates">
      <header className="hc-service-data-selection-panel-header">
        <h2 className="hc-service-data-selection-panel-title">{selectionTitle}</h2>
        <div className="hc-service-data-selection-panel-header-actions">
          {showMissingCpFilter ? (
            <label className="hc-checkbox-label hc-service-data-selection-panel-filter">
              <input
                type="checkbox"
                checked={missingCpTemplateOnly}
                onChange={(event) => setMissingCpTemplateOnly(event.target.checked)}
              />
              Missing CP template only
            </label>
          ) : null}
          <TableExportButton
            disabled={loading || exportRows.length === 0}
            ariaLabel="Export selected service day patients as Excel"
            onClick={handleExport}
          />
        </div>
      </header>
      <nav
        className="hc-strategy-tabs hc-service-data-selection-panel-tabs"
        aria-label="Selection panel view"
      >
        <div className="hc-strategy-tabs-list">
          <button
            type="button"
            className={`hc-strategy-tab${
              activeTab === 'patients' ? ' hc-strategy-tab--active' : ''
            }`}
            onClick={() => setActiveTab('patients')}
          >
            Patients
          </button>
          <button
            type="button"
            className={`hc-strategy-tab${
              activeTab === 'services' ? ' hc-strategy-tab--active' : ''
            }`}
            onClick={() => setActiveTab('services')}
          >
            Services
          </button>
        </div>
      </nav>
      <div className="hc-service-data-selection-panel-list">
        <div className="hc-service-data-selection-panel-item">
          {activeTab === 'patients' ? (
            <>
              <span className="hc-service-data-selection-panel-item-counts">
                {loading
                  ? '…'
                  : filterActive
                    ? `${totalServiceCount} service${totalServiceCount === 1 ? '' : 's'}, ${missingCpCount} of ${consolidatedPatients.length} patient${
                        consolidatedPatients.length === 1 ? '' : 's'
                      } missing CP template`
                    : `${totalServiceCount} service${totalServiceCount === 1 ? '' : 's'}, ${consolidatedPatients.length} patient${
                        consolidatedPatients.length === 1 ? '' : 's'
                      }`}
              </span>
              {consolidatedPatients.length > 0 || loading ? (
                <ServiceDayPatientsTable
                  patients={consolidatedPatients}
                  hasCarePlanImports={hasCarePlanImports}
                  missingCpTemplateOnly={filterActive}
                  loading={loading}
                />
              ) : null}
            </>
          ) : (
            <>
              <span className="hc-service-data-selection-panel-item-counts">
                {loading
                  ? '…'
                  : filterActive
                    ? `${consolidatedServices.filter((service) => !service.hasTemplatedCarePlan).length} of ${consolidatedServices.length} service${
                        consolidatedServices.length === 1 ? '' : 's'
                      } missing CP template`
                    : `${consolidatedServices.length} service${
                        consolidatedServices.length === 1 ? '' : 's'
                      }`}
              </span>
              {consolidatedServices.length > 0 || loading ? (
                <ServiceDayServicesTable
                  services={consolidatedServices}
                  hasCarePlanImports={hasCarePlanImports}
                  missingCpTemplateOnly={filterActive}
                  loading={loading}
                />
              ) : null}
            </>
          )}
        </div>
      </div>
    </aside>
  );
}

