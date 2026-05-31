import { useMemo } from 'react';
import {
  DAILY_PROGRESS_SEGMENT_LABELS,
  DAILY_PROGRESS_SEGMENT_ORDER,
  type DailyProgressSegment,
  type DailyProgressSnapshot,
  formatChartAxisDay,
  formatChartDayLabel,
  maxDailyTotal,
  yAxisTicks,
} from '../progress/computeDailyProgressSeries';

const SEGMENT_CLASS: Record<DailyProgressSegment, string> = {
  pendingConversion: 'hc-daily-chart-seg--pending-conversion',
  pendingReassessment: 'hc-daily-chart-seg--pending-reassessment',
  pendingDischarge: 'hc-daily-chart-seg--pending-discharge',
  completeConverted: 'hc-daily-chart-seg--complete-converted',
  completeDischarged: 'hc-daily-chart-seg--complete-discharged',
};

interface DailyProgressChartProps {
  series: DailyProgressSnapshot[];
}

function todayIso(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function DailyProgressChart({ series }: DailyProgressChartProps) {
  const maxTotal = useMemo(() => maxDailyTotal(series), [series]);
  const ticks = useMemo(() => yAxisTicks(maxTotal), [maxTotal]);
  const yMax = ticks[0] ?? maxTotal;
  const today = todayIso();

  return (
    <div className="hc-daily-chart" role="img" aria-label="Daily record progress from May 30 to June 22">
      <div className="hc-daily-chart-header">
        <h2 className="hc-progress-card-title hc-daily-chart-title">Overall Progress</h2>
        <div className="hc-daily-chart-legend">
          {DAILY_PROGRESS_SEGMENT_ORDER.map((segment) => (
            <span key={segment} className="hc-daily-chart-legend-item">
              <span className={`hc-daily-chart-legend-swatch ${SEGMENT_CLASS[segment]}`} />
              {DAILY_PROGRESS_SEGMENT_LABELS[segment]}
            </span>
          ))}
        </div>
      </div>

      <div className="hc-daily-chart-body">
        <div className="hc-daily-chart-y-side">
          <div className="hc-daily-chart-y-title-wrap">
            <span className="hc-daily-chart-y-title">Total # Records</span>
          </div>
          <div className="hc-daily-chart-y-axis" aria-hidden>
            {ticks.map((tick) => (
              <span key={tick} className="hc-daily-chart-y-tick">
                {tick}
              </span>
            ))}
          </div>
        </div>

        <div className="hc-daily-chart-plot-wrap">
          <div className="hc-daily-chart-y-axis-line" aria-hidden />
          <div className="hc-daily-chart-scroll">
            <div
              className="hc-daily-chart-plot-inner"
              style={{ gridTemplateColumns: `repeat(${series.length}, minmax(0, 1fr))` }}
            >
              <div className="hc-daily-chart-plot-area">
                <div
                  className="hc-daily-chart-grid"
                  style={{ gridTemplateRows: `repeat(${Math.max(ticks.length - 1, 1)}, 1fr)` }}
                  aria-hidden
                >
                  {ticks.slice(0, -1).map((tick) => (
                    <div key={tick} className="hc-daily-chart-grid-line" />
                  ))}
                </div>
                <div className="hc-daily-chart-x-axis-line" aria-hidden />
              </div>
              {series.map((day, index) => {
                const barHeightPct = yMax > 0 ? (day.total / yMax) * 100 : 0;
                const isToday = day.date === today;
                const tooltipParts = DAILY_PROGRESS_SEGMENT_ORDER.filter(
                  (segment) => day[segment] > 0
                ).map((segment) => `${DAILY_PROGRESS_SEGMENT_LABELS[segment]}: ${day[segment]}`);

                return (
                  <div
                    key={day.date}
                    className={`hc-daily-chart-day${isToday ? ' hc-daily-chart-day--today' : ''}`}
                    style={{ gridColumn: index + 1 }}
                  >
                    <div
                      className={`hc-daily-chart-column${isToday ? ' hc-daily-chart-column--today' : ''}`}
                    >
                      <div
                        className="hc-daily-chart-bar-group"
                        style={{ height: `${barHeightPct}%` }}
                      >
                        {day.total > 0 ? (
                          <span className="hc-daily-chart-bar-total">{day.total}</span>
                        ) : null}
                        <div
                          className="hc-daily-chart-bar-stack"
                          title={`${formatChartAxisDay(day.date)} — ${day.total} records${
                            tooltipParts.length ? `\n${tooltipParts.join('\n')}` : ''
                          }`}
                        >
                          {DAILY_PROGRESS_SEGMENT_ORDER.map((segment) => {
                            const count = day[segment];
                            if (!count) return null;
                            return (
                              <div
                                key={segment}
                                className={`hc-daily-chart-seg ${SEGMENT_CLASS[segment]}`}
                                style={{ flex: count }}
                                title={`${DAILY_PROGRESS_SEGMENT_LABELS[segment]}: ${count}`}
                              />
                            );
                          })}
                        </div>
                      </div>
                    </div>
                    <div className="hc-daily-chart-x-label">{formatChartDayLabel(day.date)}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
