import { useState, useMemo, useEffect, useCallback, useRef, type CSSProperties, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import type { PayPeriod, PayPeriodStatus, BillingStatus } from '../types';
import { getWeekStart } from '../types';
import { WeekWorkspace } from './WeekWorkspace';
import type { Profile } from '../../homecare/types';
import { supabase } from '../../lib/supabase';

// ── Calendar helpers ──────────────────────────────────────────────────────────

const WEEKDAY_LABELS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

function toIsoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function dateToIso(date: Date): string {
  return toIsoDate(date.getFullYear(), date.getMonth(), date.getDate());
}

function buildCalendarWeeks(year: number, month: number): Date[][] {
  const weeks: Date[][] = [];
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startOffset = (new Date(year, month, 1).getDay() + 6) % 7; // Monday = 0
  let day = 1 - startOffset;
  let includedLastDay = false;

  while (!includedLastDay) {
    const week: Date[] = [];
    for (let col = 0; col < 7; col++) {
      week.push(new Date(year, month, day));
      day++;
    }
    weeks.push(week);
    if (week.some((d) => d.getMonth() === month && d.getDate() === daysInMonth)) {
      includedLastDay = true;
    }
  }
  return weeks;
}

function shiftMonth(year: number, month: number, delta: number) {
  const d = new Date(year, month + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() };
}

function formatMonthYear(year: number, month: number): string {
  return new Date(year, month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function formatWeekDateRange(week: Date[]): string {
  const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${fmt(week[0])} – ${fmt(week[6])}`;
}

function formatMonthDay(d: Date): string {
  const month = d.toLocaleDateString('en-US', { month: 'short' });
  const day = String(d.getDate()).padStart(2, '0');
  return `${month} ${day}`;
}

function formatWeekOfLabel(weekStartIso: string): string {
  const start = new Date(`${weekStartIso}T12:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);

  return `${formatMonthDay(start)} - ${formatMonthDay(end)}, ${end.getFullYear()}`;
}

function buildPayYearWeeks(yearStart: Date): string[] {
  const yearEnd = new Date(yearStart.getFullYear() + 1, yearStart.getMonth(), yearStart.getDate() - 1);
  const weeks: string[] = [];
  const cursor = getWeekStart(yearStart);
  const end = getWeekStart(yearEnd);

  while (cursor <= end) {
    weeks.push(dateToIso(cursor));
    cursor.setDate(cursor.getDate() + 7);
  }

  return weeks;
}

const PAY_YEAR_WEEKS = buildPayYearWeeks(new Date(2026, 3, 1));

type WeekVisitCounts = { billable: number; notBillable: number; total: number };

function weekStartForDate(isoDate: string): string {
  return dateToIso(getWeekStart(new Date(`${isoDate}T12:00:00`)));
}

async function fetchWeekCountsForPayYear(weekStarts: string[]): Promise<Map<string, WeekVisitCounts>> {
  const map = new Map<string, WeekVisitCounts>();
  for (const weekStart of weekStarts) {
    map.set(weekStart, { billable: 0, notBillable: 0, total: 0 });
  }
  if (!weekStarts.length) return map;

  const rangeEnd = new Date(`${weekStarts[weekStarts.length - 1]}T12:00:00`);
  rangeEnd.setDate(rangeEnd.getDate() + 6);
  const rangeEndIso = dateToIso(rangeEnd);

  const { data } = await supabase
    .from('service_visits')
    .select('service_date, billing_status')
    .gte('service_date', weekStarts[0])
    .lte('service_date', rangeEndIso)
    .not('pay_period_id', 'is', null);

  for (const row of data ?? []) {
    const weekStart = weekStartForDate(row.service_date as string);
    const counts = map.get(weekStart);
    if (!counts) continue;

    const status = row.billing_status as BillingStatus;
    counts.total++;
    if (status === 'billable') counts.billable++;
    else if (status === 'not_billable') counts.notBillable++;
  }

  return map;
}

function WeekStatusBadge({ status }: { status: PayPeriodStatus | 'not_started' }) {
  if (status === 'finalized') {
    return <span className="hc-badge hc-badge--ready_for_spo hc-billing-pay-cycle-week-status">Finalized</span>;
  }
  if (status === 'in_progress') {
    return <span className="hc-badge hc-badge--in_review hc-billing-pay-cycle-week-status">In Progress</span>;
  }
  return <span className="hc-badge hc-badge--draft hc-billing-pay-cycle-week-status">Not Started</span>;
}

// ── Day cell visit counts (loaded from DB) ────────────────────────────────────

type DayCount = { total: number; billable: number; notBillable: number; dq: number; inv: number };
type DayCountsByDate = Map<string, DayCount>;

async function fetchDayCountsForRange(
  startIso: string,
  endIso: string
): Promise<DayCountsByDate> {
  const { data } = await supabase
    .from('service_visits')
    .select('service_date, billing_status')
    .gte('service_date', startIso)
    .lte('service_date', endIso)
    .not('pay_period_id', 'is', null);

  const map: DayCountsByDate = new Map();
  for (const row of data ?? []) {
    const date = row.service_date as string;
    const status = row.billing_status as BillingStatus;
    const existing = map.get(date) ?? { total: 0, billable: 0, notBillable: 0, dq: 0, inv: 0 };
    existing.total++;
    if (status === 'billable') existing.billable++;
    else if (status === 'not_billable') existing.notBillable++;
    else if (status === 'data_quality') existing.dq++;
    else if (status === 'needs_investigation') existing.inv++;
    map.set(date, existing);
  }
  return map;
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function ChevronLeft() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M15 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function ChevronRight() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function ChevronDown() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function BillableIcon() {
  return (
    <svg
      className="hc-billing-pay-cycle-week-col-icon"
      xmlns="http://www.w3.org/2000/svg"
      width="1em"
      height="1em"
      viewBox="0 0 1024 1024"
      aria-hidden
    >
      <path d="M0 0h1024v1024H0z" fill="none" />
      <path
        fill="currentColor"
        d="M512 64C264.6 64 64 264.6 64 512s200.6 448 448 448s448-200.6 448-448S759.4 64 512 64m0 820c-205.4 0-372-166.6-372-372s166.6-372 372-372s372 166.6 372 372s-166.6 372-372 372m47.7-395.2l-25.4-5.9V348.6c38 5.2 61.5 29 65.5 58.2c.5 4 3.9 6.9 7.9 6.9h44.9c4.7 0 8.4-4.1 8-8.8c-6.1-62.3-57.4-102.3-125.9-109.2V263c0-4.4-3.6-8-8-8h-28.1c-4.4 0-8 3.6-8 8v33c-70.8 6.9-126.2 46-126.2 119c0 67.6 49.8 100.2 102.1 112.7l24.7 6.3v142.7c-44.2-5.9-69-29.5-74.1-61.3c-.6-3.8-4-6.6-7.9-6.6H363c-4.7 0-8.4 4-8 8.7c4.5 55 46.2 105.6 135.2 112.1V761c0 4.4 3.6 8 8 8h28.4c4.4 0 8-3.6 8-8.1l-.2-31.7c78.3-6.9 134.3-48.8 134.3-124c-.1-69.4-44.2-100.4-109-116.4m-68.6-16.2c-5.6-1.6-10.3-3.1-15-5c-33.8-12.2-49.5-31.9-49.5-57.3c0-36.3 27.5-57 64.5-61.7zM534.3 677V543.3c3.1.9 5.9 1.6 8.8 2.2c47.3 14.4 63.2 34.4 63.2 65.1c0 39.1-29.4 62.6-72 66.4"
      />
    </svg>
  );
}
function UnbillableIcon() {
  return (
    <svg
      className="hc-billing-pay-cycle-week-col-icon"
      xmlns="http://www.w3.org/2000/svg"
      width="1em"
      height="1em"
      viewBox="0 0 24 24"
      aria-hidden
    >
      <path d="M0 0h24v24H0z" fill="none" />
      <path
        fill="currentColor"
        d="M3 4.27L4.28 3L21 19.72L19.73 21l-3.67-3.67c-.62.67-1.52 1.22-2.56 1.49V21h-3v-2.18C8.47 18.31 7 16.79 7 15h2c0 1.08 1.37 2 3 2c1.13 0 2.14-.44 2.65-1.08l-2.97-2.97C9.58 12.42 7 11.75 7 9c0-.23 0-.45.07-.66zm7.5.91V3h3v2.18C15.53 5.69 17 7.21 17 9h-2c0-1.08-1.37-2-3-2c-.37 0-.72.05-1.05.13L9.4 5.58z"
      />
    </svg>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface PayCyclesTabProps {
  payPeriods: PayPeriod[];
  loading: boolean;
  error: string | null;
  canEdit: boolean;
  profile: Profile | null;
  onRefresh: () => Promise<void>;
  /** ISO date from most recent import — navigates calendar to that month */
  initialDate?: string | null;
}

// ── Main component ────────────────────────────────────────────────────────────

export function PayCyclesTab({
  payPeriods,
  loading,
  error,
  canEdit,
  profile,
  onRefresh,
  initialDate,
}: PayCyclesTabProps) {
  const today = useMemo(() => new Date(), []);
  const [visibleYear, setVisibleYear] = useState(() => {
    if (initialDate) return new Date(`${initialDate}T12:00:00`).getFullYear();
    return today.getFullYear();
  });
  const [visibleMonth, setVisibleMonth] = useState(() => {
    if (initialDate) return new Date(`${initialDate}T12:00:00`).getMonth();
    return today.getMonth();
  });

  // Navigate when a new import arrives
  useEffect(() => {
    if (!initialDate) return;
    const d = new Date(`${initialDate}T12:00:00`);
    setVisibleYear(d.getFullYear());
    setVisibleMonth(d.getMonth());
  }, [initialDate]);
  const [selectedWeekStart, setSelectedWeekStart] = useState<string | null>(null);
  const [hoveredWeekStart, setHoveredWeekStart] = useState<string | null>(null);
  const [dayCounts, setDayCounts] = useState<DayCountsByDate>(() => new Map());
  const [countsLoading, setCountsLoading] = useState(false);
  const [weekCounts, setWeekCounts] = useState<Map<string, WeekVisitCounts>>(() => new Map());
  const [weekCountsLoading, setWeekCountsLoading] = useState(false);
  const asideTableRef = useRef<HTMLDivElement>(null);
  const [showAsideScrollHint, setShowAsideScrollHint] = useState(false);

  const updateAsideScrollHint = useCallback(() => {
    const el = asideTableRef.current;
    if (!el) {
      setShowAsideScrollHint(false);
      return;
    }
    const hasOverflow = el.scrollHeight > el.clientHeight + 1;
    const isAtBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 4;
    setShowAsideScrollHint(hasOverflow && !isAtBottom);
  }, []);

  const weeks = useMemo(() => buildCalendarWeeks(visibleYear, visibleMonth), [visibleYear, visibleMonth]);
  const todayIso = useMemo(() => dateToIso(today), [today]);

  const periodByWeek = useMemo(() => {
    const map = new Map<string, PayPeriod>();
    for (const p of payPeriods) map.set(p.week_start, p);
    return map;
  }, [payPeriods]);

  const selectedPeriod = selectedWeekStart ? (periodByWeek.get(selectedWeekStart) ?? null) : null;

  // Fetch day counts whenever month changes
  const loadCounts = useCallback(async () => {
    if (!weeks.length) return;
    setCountsLoading(true);
    const firstDay = dateToIso(weeks[0][0]);
    const lastDay = dateToIso(weeks[weeks.length - 1][6]);
    const counts = await fetchDayCountsForRange(firstDay, lastDay);
    setDayCounts(counts);
    setCountsLoading(false);
  }, [weeks]);

  useEffect(() => { void loadCounts(); }, [loadCounts]);

  const loadWeekCounts = useCallback(async () => {
    setWeekCountsLoading(true);
    const counts = await fetchWeekCountsForPayYear(PAY_YEAR_WEEKS);
    setWeekCounts(counts);
    setWeekCountsLoading(false);
  }, []);

  useEffect(() => { void loadWeekCounts(); }, [loadWeekCounts, payPeriods]);

  useEffect(() => {
    updateAsideScrollHint();
    const el = asideTableRef.current;
    if (!el) return undefined;

    const observer = new ResizeObserver(() => updateAsideScrollHint());
    observer.observe(el);
    window.addEventListener('resize', updateAsideScrollHint);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateAsideScrollHint);
    };
  }, [updateAsideScrollHint, weekCountsLoading, loading]);

  const prevMonth = useMemo(() => shiftMonth(visibleYear, visibleMonth, -1), [visibleYear, visibleMonth]);
  const nextMonth = useMemo(() => shiftMonth(visibleYear, visibleMonth, 1), [visibleYear, visibleMonth]);

  const goToPrev = () => { setVisibleYear(prevMonth.year); setVisibleMonth(prevMonth.month); };
  const goToNext = () => { setVisibleYear(nextMonth.year); setVisibleMonth(nextMonth.month); };

  const handleWeekClick = (weekStartIso: string) => {
    const weekMonday = new Date(`${weekStartIso}T12:00:00`);
    setVisibleYear(weekMonday.getFullYear());
    setVisibleMonth(weekMonday.getMonth());
    setSelectedWeekStart(weekStartIso);
  };

  const closeWeekModal = useCallback(() => {
    setSelectedWeekStart(null);
  }, []);

  const handleWeekModalBackdrop = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) closeWeekModal();
  };

  useEffect(() => {
    if (!selectedWeekStart) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeWeekModal();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedWeekStart, closeWeekModal]);

  if (loading) return <p className="hc-muted" style={{ padding: '1.5rem' }}>Loading pay periods…</p>;
  if (error)   return <p className="hc-form-error" style={{ padding: '1.5rem' }}>{error}</p>;

  const monthLabel = formatMonthYear(visibleYear, visibleMonth);
  const selectedWeekLabel = selectedWeekStart
    ? formatWeekDateRange(
        Array.from({ length: 7 }, (_, i) => {
          const d = new Date(`${selectedWeekStart}T12:00:00`);
          d.setDate(d.getDate() + i);
          return d;
        })
      )
    : '';

  return (
    <div className="hc-billing-pay-cycles-layout">

      {/* ── Calendar ──────────────────────────────────────── */}
      <div className="hc-service-data-calendar hc-billing-pay-cycle-calendar" aria-label="Pay cycle calendar">
        <div className="hc-billing-pay-cycle-calendar-aside">
          <div
            className="hc-service-data-calendar-dow hc-billing-pay-cycle-calendar-aside-header"
            role="columnheader"
          >
            Pay Weeks
          </div>
          <div className="hc-billing-pay-cycle-calendar-aside-table-scroll">
            <div
              ref={asideTableRef}
              className="hc-billing-pay-cycle-calendar-aside-table-wrap"
              onScroll={updateAsideScrollHint}
            >
            <table className="hc-table hc-table--grid hc-billing-pay-cycle-weeks-table">
              <thead>
                <tr>
                  <th className="hc-billing-pay-cycle-week-col-label" scope="col">Week</th>
                  <th className="hc-billing-pay-cycle-week-col-stat" scope="col" aria-label="Billable">
                    <BillableIcon />
                  </th>
                  <th className="hc-billing-pay-cycle-week-col-stat" scope="col" aria-label="Unbillable">
                    <UnbillableIcon />
                  </th>
                  <th className="hc-billing-pay-cycle-week-col-stat" scope="col">Total</th>
                  <th className="hc-billing-pay-cycle-week-col-status" scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {PAY_YEAR_WEEKS.map((weekStartIso) => {
                  const isSelected = selectedWeekStart === weekStartIso;
                  const period = periodByWeek.get(weekStartIso);
                  const status = period?.status ?? 'not_started';
                  const counts = weekCounts.get(weekStartIso);
                  const countValue = (value: number | undefined) =>
                    weekCountsLoading ? '…' : String(value ?? 0);

                  return (
                    <tr
                      key={weekStartIso}
                      className={[
                        'hc-billing-pay-cycle-week-row',
                        isSelected ? 'hc-billing-pay-cycle-week-row--selected' : '',
                      ].filter(Boolean).join(' ')}
                      onClick={() => handleWeekClick(weekStartIso)}
                      onMouseEnter={() => setHoveredWeekStart(weekStartIso)}
                      onMouseLeave={() => setHoveredWeekStart(null)}
                    >
                      <td className="hc-billing-pay-cycle-week-col-label">{formatWeekOfLabel(weekStartIso)}</td>
                      <td className="hc-billing-pay-cycle-week-col-stat">{countValue(counts?.billable)}</td>
                      <td className="hc-billing-pay-cycle-week-col-stat">{countValue(counts?.notBillable)}</td>
                      <td className="hc-billing-pay-cycle-week-col-stat">{countValue(counts?.total)}</td>
                      <td className="hc-billing-pay-cycle-week-col-status">
                        <WeekStatusBadge status={status} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
            {showAsideScrollHint && (
              <div className="hc-billing-pay-cycle-calendar-aside-scroll-hint" aria-hidden>
                <ChevronDown />
              </div>
            )}
          </div>
        </div>

        <div className="hc-billing-pay-cycle-calendar-main">
        {/* Nav bar */}
        <div className="hc-service-data-calendar-nav">
          <div className="hc-service-data-calendar-nav-center">
            <button type="button" className="hc-service-data-calendar-nav-btn" onClick={goToPrev} aria-label={`Previous month, ${formatMonthYear(prevMonth.year, prevMonth.month)}`}>
              <ChevronLeft />
            </button>
            <h2 className="hc-service-data-calendar-month">{monthLabel}</h2>
            <button type="button" className="hc-service-data-calendar-nav-btn" onClick={goToNext} aria-label={`Next month, ${formatMonthYear(nextMonth.year, nextMonth.month)}`}>
              <ChevronRight />
            </button>
          </div>
        </div>

        {/* Grid */}
        <div
          className="hc-service-data-calendar-grid hc-billing-pay-cycle-calendar-grid"
          role="grid"
          aria-label={monthLabel}
          style={{ '--hc-service-data-calendar-week-rows': weeks.length } as CSSProperties}
        >
          {WEEKDAY_LABELS.map((label) => (
            <div key={label} className="hc-service-data-calendar-dow" role="columnheader">{label}</div>
          ))}

          {weeks.flatMap((week, weekIndex) => {
            const weekStartIso = dateToIso(week[0]);
            const isSelected   = selectedWeekStart === weekStartIso;
            const isHovered    = hoveredWeekStart === weekStartIso;

            return week.map((date, dayIndex) => {
                const isoDate       = dateToIso(date);
                const isToday       = isoDate === todayIso;
                const isOutside     = date.getMonth() !== visibleMonth;
                const counts        = dayCounts.get(isoDate);
                const hasCounts     = !!(counts?.total);

                const cellClass = [
                  'hc-service-data-calendar-cell',
                  isToday   ? 'hc-service-data-calendar-cell--today'         : '',
                  isOutside ? 'hc-service-data-calendar-cell--outside-month' : '',
                  isSelected ? 'hc-billing-calendar-day--selected-week'      : '',
                  isHovered  ? 'hc-billing-calendar-day--hovered-week'       : '',
                ].filter(Boolean).join(' ');

                return (
                  <div
                    key={`${isoDate}-${weekIndex}-${dayIndex}`}
                    className={cellClass}
                    role="gridcell"
                    aria-label={date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                    onClick={() => handleWeekClick(weekStartIso)}
                    style={{ cursor: 'pointer' }}
                  >
                    <div className="hc-service-data-calendar-day-header">
                      <div className="hc-service-data-calendar-day-header-top">
                        <div className="hc-service-data-calendar-day-summary-badge">
                          <div className="hc-service-data-calendar-day-summary-main">
                            <div className="hc-service-data-calendar-day-num">
                              <span className="hc-service-data-calendar-day-num-day">{String(date.getDate()).padStart(2, '0')}</span>
                              <span className="hc-service-data-calendar-day-num-month">
                                {date.toLocaleDateString('en-US', { month: 'short' })}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                    {hasCounts && !countsLoading && (
                      <div className="hc-service-data-calendar-day-stats">
                        <div className="hc-billing-calendar-day-counts">
                          <span className="hc-billing-day-count hc-billing-day-count--total">
                            {counts!.total}
                          </span>
                          {counts!.billable > 0 && (
                            <span className="hc-billing-day-count hc-billing-day-count--billable">
                              {counts!.billable}
                            </span>
                          )}
                          {counts!.notBillable > 0 && (
                            <span className="hc-billing-day-count hc-billing-day-count--not-billable">
                              {counts!.notBillable}
                            </span>
                          )}
                          {counts!.dq > 0 && (
                            <span className="hc-billing-day-count hc-billing-day-count--dq">
                              {counts!.dq}
                            </span>
                          )}
                          {counts!.inv > 0 && (
                            <span className="hc-billing-day-count hc-billing-day-count--inv">
                              {counts!.inv}
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                    {hasCounts && countsLoading && (
                      <div className="hc-service-data-calendar-day-stats">
                        <span className="hc-muted" style={{ fontSize: '0.65rem' }}>…</span>
                      </div>
                    )}
                  </div>
                );
              });
          })}
        </div>
        </div>
      </div>

      {selectedWeekStart && createPortal(
        <div
          className="hc-billing-week-modal-backdrop"
          role="dialog"
          aria-modal
          aria-label={`Week workspace: ${selectedWeekLabel}`}
          onClick={handleWeekModalBackdrop}
        >
          <div
            className="hc-billing-week-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="hc-billing-week-modal-header">
              <h2 className="hc-billing-week-modal-title">{selectedWeekLabel}</h2>
              <button
                type="button"
                className="hc-btn hc-btn-ghost hc-modal-close"
                aria-label="Close week workspace"
                onClick={closeWeekModal}
              >
                ✕
              </button>
            </div>
            <div className="hc-billing-week-modal-body">
              <WeekWorkspace
                weekStart={selectedWeekStart}
                payPeriod={selectedPeriod}
                canEdit={canEdit}
                profile={profile}
                onRefresh={async () => { await onRefresh(); await loadCounts(); await loadWeekCounts(); }}
              />
            </div>
          </div>
        </div>,
        document.body
      )}

    </div>
  );
}
