import { useState, useMemo, useEffect, useCallback, type CSSProperties } from 'react';
import type { PayPeriod, BillingStatus } from '../types';
import { daysUntilDeadline } from '../types';
import { WeekWorkspace } from './WeekWorkspace';
import type { Profile } from '../../homecare/types';
import { supabase } from '../../lib/supabase';

// ── Calendar helpers ──────────────────────────────────────────────────────────

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

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

// ── Pay period status colours ─────────────────────────────────────────────────

function WeekStatusBadge({ status }: { status: PayPeriod['status'] | 'not_started' }) {
  if (status === 'finalized')   return <span className="hc-badge hc-badge--ready_for_spo" style={{ fontSize: '0.65rem' }}>Finalized</span>;
  if (status === 'in_progress') return <span className="hc-badge hc-badge--in_review" style={{ fontSize: '0.65rem' }}>In Progress</span>;
  return <span className="hc-badge hc-badge--draft" style={{ fontSize: '0.65rem' }}>Not started</span>;
}

// ── Day cell visit counts (loaded from DB) ────────────────────────────────────

type DayCountsByDate = Map<string, { total: number; dq: number; inv: number; clean: number }>;

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
    const existing = map.get(date) ?? { total: 0, dq: 0, inv: 0, clean: 0 };
    existing.total++;
    if (status === 'data_quality') existing.dq++;
    else if (status === 'needs_investigation') existing.inv++;
    else if (status === 'clean' || status === 'billable') existing.clean++;
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
  const [dayCounts, setDayCounts] = useState<DayCountsByDate>(() => new Map());
  const [countsLoading, setCountsLoading] = useState(false);

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

  const prevMonth = useMemo(() => shiftMonth(visibleYear, visibleMonth, -1), [visibleYear, visibleMonth]);
  const nextMonth = useMemo(() => shiftMonth(visibleYear, visibleMonth, 1), [visibleYear, visibleMonth]);

  const goToPrev = () => { setVisibleYear(prevMonth.year); setVisibleMonth(prevMonth.month); };
  const goToNext = () => { setVisibleYear(nextMonth.year); setVisibleMonth(nextMonth.month); };

  const handleWeekClick = (weekStartIso: string) => {
    setSelectedWeekStart((prev) => (prev === weekStartIso ? null : weekStartIso));
  };

  if (loading) return <p className="hc-muted" style={{ padding: '1.5rem' }}>Loading pay periods…</p>;
  if (error)   return <p className="hc-form-error" style={{ padding: '1.5rem' }}>{error}</p>;

  const monthLabel = formatMonthYear(visibleYear, visibleMonth);

  // ── Drill-in: show week workspace fullscreen ──────────────────────────────
  if (selectedWeekStart) {
    return (
      <div className="hc-billing-pay-cycles-layout">
        {/* Breadcrumb */}
        <div className="hc-billing-week-breadcrumb">
          <button
            type="button"
            className="hc-billing-week-breadcrumb-back"
            onClick={() => setSelectedWeekStart(null)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M19 12H5M12 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Pay Cycles
          </button>
          <span className="hc-billing-week-breadcrumb-sep">/</span>
          <span className="hc-billing-week-breadcrumb-current">
            {formatWeekDateRange(
              Array.from({ length: 7 }, (_, i) => {
                const d = new Date(`${selectedWeekStart}T12:00:00`);
                d.setDate(d.getDate() + i);
                return d;
              })
            )}
          </span>
        </div>

        <WeekWorkspace
          weekStart={selectedWeekStart}
          payPeriod={selectedPeriod}
          canEdit={canEdit}
          profile={profile}
          onRefresh={async () => { await onRefresh(); await loadCounts(); }}
        />
      </div>
    );
  }

  return (
    <div className="hc-billing-pay-cycles-layout">

      {/* ── Calendar ──────────────────────────────────────── */}
      <div className="hc-service-data-calendar" aria-label="Pay cycle calendar">

        {/* Nav bar */}
        <div className="hc-service-data-calendar-nav">
          <div className="hc-service-data-calendar-nav-filters hc-service-data-calendar-nav-filters--start" aria-hidden />
          <div className="hc-service-data-calendar-nav-center">
            <button type="button" className="hc-service-data-calendar-nav-btn" onClick={goToPrev} aria-label={`Previous month, ${formatMonthYear(prevMonth.year, prevMonth.month)}`}>
              <ChevronLeft />
            </button>
            <h2 className="hc-service-data-calendar-month">{monthLabel}</h2>
            <button type="button" className="hc-service-data-calendar-nav-btn" onClick={goToNext} aria-label={`Next month, ${formatMonthYear(nextMonth.year, nextMonth.month)}`}>
              <ChevronRight />
            </button>
          </div>
          <div className="hc-service-data-calendar-nav-filters hc-service-data-calendar-nav-filters--end">
            <p className="hc-muted" style={{ fontSize: '0.8rem', margin: 0 }}>
              Click a week row to open its workspace
            </p>
          </div>
        </div>

        {/* Grid */}
        <div
          className="hc-service-data-calendar-grid"
          role="grid"
          aria-label={monthLabel}
          style={{ '--hc-service-data-calendar-week-rows': weeks.length } as CSSProperties}
        >
          {/* Column headers */}
          <div className="hc-service-data-calendar-dow hc-service-data-calendar-dow--gutter" role="columnheader">
            <div className="hc-service-data-calendar-day-header">
              <div className="hc-service-data-calendar-day-header-top">
                <div className="hc-service-data-calendar-day-summary-badge">
                  <div className="hc-service-data-calendar-day-summary-main">
                    <div className="hc-service-data-calendar-day-num">
                      <span className="hc-service-data-calendar-week-label-heading">Pay Week</span>
                      <span className="hc-service-data-calendar-week-label-dates">Status</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          {WEEKDAY_LABELS.map((label) => (
            <div key={label} className="hc-service-data-calendar-dow" role="columnheader">{label}</div>
          ))}

          {/* Rows */}
          {weeks.flatMap((week, weekIndex) => {
            const weekStartIso = dateToIso(week[0]);
            const weekEndIso   = dateToIso(week[6]);
            const period       = periodByWeek.get(weekStartIso);
            const status       = period?.status ?? 'not_started';
            const isSelected   = selectedWeekStart === weekStartIso;
            const deadline     = period?.submission_deadline;
            const daysLeft     = deadline ? daysUntilDeadline(deadline) : null;

            // Aggregate counts for the week
            let weekTotal = 0, weekDq = 0, weekInv = 0;
            for (const d of week) {
              const iso = dateToIso(d);
              const c = dayCounts.get(iso);
              if (c) { weekTotal += c.total; weekDq += c.dq; weekInv += c.inv; }
            }

            const gutterClass = [
              'hc-service-data-calendar-cell',
              'hc-service-data-calendar-cell--gutter',
              'hc-billing-calendar-gutter',
              `hc-billing-calendar-gutter--${status}`,
              isSelected ? 'hc-billing-calendar-gutter--selected' : '',
            ].filter(Boolean).join(' ');

            return [
              // ── Week gutter cell ────────────────────────────────────
              <div
                key={`gutter-${weekIndex}`}
                className={gutterClass}
                role="gridcell"
                aria-label={`Week of ${formatWeekDateRange(week)}, ${status}`}
                onClick={() => handleWeekClick(weekStartIso)}
                style={{ cursor: 'pointer' }}
              >
                <div className="hc-service-data-calendar-day-header">
                  <div className="hc-service-data-calendar-day-header-top">
                    <div className="hc-service-data-calendar-day-summary-badge hc-service-data-calendar-week-summary-badge">
                      <div className="hc-service-data-calendar-day-summary-main">
                        <div className="hc-service-data-calendar-day-num">
                          <span className="hc-service-data-calendar-week-label-heading">{weekStartIso === dateToIso(week[0]) ? formatWeekDateRange(week) : ''}</span>
                          <span className="hc-service-data-calendar-week-label-dates">{weekEndIso}</span>
                        </div>
                        {weekTotal > 0 && (
                          <>
                            <span className="hc-service-data-calendar-day-summary-sep" aria-hidden />
                            <span className="hc-service-data-calendar-visit-count">
                              {countsLoading ? '…' : `${weekTotal} visit${weekTotal !== 1 ? 's' : ''}`}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Status + deadline */}
                <div className="hc-service-data-calendar-day-stats">
                  <div className="hc-service-data-calendar-day-body">
                    <div className="hc-billing-gutter-status">
                      <WeekStatusBadge status={status} />
                      {status === 'in_progress' && daysLeft !== null && (
                        <span className={`hc-billing-deadline-chip${daysLeft <= 2 ? ' hc-billing-deadline-chip--urgent' : ''}`}>
                          {daysLeft <= 0 ? 'Overdue' : `${daysLeft}d left`}
                        </span>
                      )}
                    </div>
                    {status !== 'not_started' && (weekDq > 0 || weekInv > 0) && (
                      <div className="hc-billing-gutter-flags">
                        {weekDq  > 0 && <span className="hc-billing-tile-count hc-billing-tile-count--dq">{weekDq} DQ</span>}
                        {weekInv > 0 && <span className="hc-billing-tile-count hc-billing-tile-count--inv">{weekInv} inv.</span>}
                      </div>
                    )}
                  </div>
                </div>
              </div>,

              // ── Day cells ────────────────────────────────────────────
              ...week.map((date, dayIndex) => {
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
                          {counts!.clean > 0 && (
                            <span className="hc-billing-day-count hc-billing-day-count--clean">
                              {counts!.clean}
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
              }),
            ];
          })}
        </div>
      </div>

    </div>
  );
}
