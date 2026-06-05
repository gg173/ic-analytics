import { useMemo } from 'react';
import type { PayPeriod, VhaPayCycle } from '../types';
import {
  VHA_TRACK_LABELS,
  formatWeekLabel,
  daysUntilDeadline,
} from '../types';

interface DashboardTabProps {
  payPeriods: PayPeriod[];
  vhaCycles: VhaPayCycle[];
  periodsLoading: boolean;
  cyclesLoading: boolean;
}

function StatusPill({ status }: { status: string }) {
  const cls =
    status === 'finalized'    ? 'hc-badge--ready_for_spo' :
    status === 'in_progress'  ? 'hc-badge--in_review' :
    status === 'not_started'  ? 'hc-badge--draft' : 'hc-badge--draft';
  const label =
    status === 'finalized'   ? 'Finalized' :
    status === 'in_progress' ? 'In Progress' : 'Not Started';
  return <span className={`hc-badge ${cls}`}>{label}</span>;
}

function DeadlinePill({ deadline }: { deadline: string }) {
  const days = daysUntilDeadline(deadline);
  const cls = days < 0 ? 'hc-badge--pushed' : days <= 2 ? 'hc-badge--in_review' : 'hc-badge--validated';
  const label = days < 0 ? 'Past due' : days === 0 ? 'Due today' : `${days}d remaining`;
  return <span className={`hc-badge ${cls}`}>{label}</span>;
}

export function DashboardTab({ payPeriods, vhaCycles, periodsLoading, cyclesLoading }: DashboardTabProps) {
  const activeWeek = useMemo(
    () => payPeriods.find((p) => p.status === 'in_progress') ?? null,
    [payPeriods]
  );

  const nursingCycles = useMemo(
    () => vhaCycles.filter((c) => c.track === 'nursing_psw').slice(0, 3),
    [vhaCycles]
  );
  const rehabCycles = useMemo(
    () => vhaCycles.filter((c) => c.track === 'rehab').slice(0, 3),
    [vhaCycles]
  );

  const summary = activeWeek?.summary;

  return (
    <div className="hc-billing-dashboard">

      {/* ── Current week status ─────────────────────────── */}
      <section className="hc-billing-dashboard-section">
        <h2 className="hc-billing-section-title">Current Week</h2>
        {periodsLoading && <p className="hc-muted">Loading…</p>}
        {!periodsLoading && !activeWeek && (
          <div className="hc-panel hc-empty">
            <p className="hc-muted">No active pay week. Open the Pay Cycles tab to initiate this week.</p>
          </div>
        )}
        {!periodsLoading && activeWeek && (
          <div className="hc-panel hc-billing-current-week">
            <div className="hc-billing-current-week-header">
              <div>
                <p className="hc-billing-week-label">{formatWeekLabel(activeWeek.week_start)}</p>
                <StatusPill status={activeWeek.status} />
              </div>
              <DeadlinePill deadline={activeWeek.submission_deadline} />
            </div>

            {summary && (
              <div className="hc-billing-summary-grid">
                <div className="hc-billing-stat">
                  <span className="hc-billing-stat-value">{summary.total}</span>
                  <span className="hc-billing-stat-label">Total visits</span>
                </div>
                <div className="hc-billing-stat hc-billing-stat--clean">
                  <span className="hc-billing-stat-value">{summary.clean + summary.billable}</span>
                  <span className="hc-billing-stat-label">Clean / Billable</span>
                </div>
                <div className="hc-billing-stat hc-billing-stat--warning">
                  <span className="hc-billing-stat-value">{summary.data_quality}</span>
                  <span className="hc-billing-stat-label">Data quality issues</span>
                </div>
                <div className="hc-billing-stat hc-billing-stat--alert">
                  <span className="hc-billing-stat-value">{summary.needs_investigation}</span>
                  <span className="hc-billing-stat-label">Investigations open</span>
                </div>
                <div className="hc-billing-stat hc-billing-stat--muted">
                  <span className="hc-billing-stat-value">{summary.not_billable}</span>
                  <span className="hc-billing-stat-label">Not billable</span>
                </div>
                <div className="hc-billing-stat hc-billing-stat--muted">
                  <span className="hc-billing-stat-value">{summary.pending}</span>
                  <span className="hc-billing-stat-label">Pending review</span>
                </div>
              </div>
            )}

            {!summary && (
              <p className="hc-muted" style={{ marginTop: '0.75rem' }}>
                Upload the Monday flat file to begin classification.
              </p>
            )}
          </div>
        )}
      </section>

      {/* ── VHA pay cycle calendars ─────────────────────── */}
      <section className="hc-billing-dashboard-section">
        <h2 className="hc-billing-section-title">VHA Pay Cycle Reference</h2>
        {cyclesLoading && <p className="hc-muted">Loading…</p>}
        {!cyclesLoading && (
          <div className="hc-billing-cycles-grid">
            {([['nursing_psw', nursingCycles], ['rehab', rehabCycles]] as const).map(([track, cycles]) => (
              <div key={track} className="hc-panel hc-billing-cycle-card">
                <h3 className="hc-panel-title">{VHA_TRACK_LABELS[track]}</h3>
                {cycles.length === 0 ? (
                  <p className="hc-muted">No cycles on record.</p>
                ) : (
                  <table className="hc-table">
                    <thead>
                      <tr>
                        <th>Cycle</th>
                        <th>Pay Day</th>
                        <th>UHN Deadline</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cycles.map((c) => {
                        const now = new Date();
                        const start = new Date(`${c.cycle_start}T12:00:00`);
                        const end = new Date(`${c.cycle_end}T12:00:00`);
                        const isActive = now >= start && now <= end;
                        return (
                          <tr key={c.id} className={isActive ? 'hc-billing-cycle-row--active' : ''}>
                            <td>
                              {isActive && <span className="hc-billing-active-dot" />}
                              {new Date(`${c.cycle_start}T12:00:00`).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}
                              {' – '}
                              {new Date(`${c.cycle_end}T12:00:00`).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}
                            </td>
                            <td>{new Date(`${c.pay_day}T12:00:00`).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}</td>
                            <td>
                              {new Date(c.submission_deadline).toLocaleDateString('en-CA', {
                                month: 'short', day: 'numeric',
                              })}{' '}
                              <span className="hc-muted" style={{ fontSize: '0.75rem' }}>10:00 AM</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Recent weeks ────────────────────────────────── */}
      <section className="hc-billing-dashboard-section">
        <h2 className="hc-billing-section-title">Recent Pay Weeks</h2>
        {periodsLoading && <p className="hc-muted">Loading…</p>}
        {!periodsLoading && payPeriods.length === 0 && (
          <div className="hc-panel hc-empty">
            <p className="hc-muted">No pay weeks on record yet.</p>
          </div>
        )}
        {!periodsLoading && payPeriods.length > 0 && (
          <div className="hc-table-wrap">
            <table className="hc-table hc-table--grid">
              <thead>
                <tr>
                  <th>Week</th>
                  <th>Status</th>
                  <th>Submission Deadline</th>
                  <th>Finalized</th>
                </tr>
              </thead>
              <tbody>
                {payPeriods.slice(0, 8).map((p) => (
                  <tr key={p.id}>
                    <td>{formatWeekLabel(p.week_start)}</td>
                    <td><StatusPill status={p.status} /></td>
                    <td>
                      {new Date(p.submission_deadline).toLocaleDateString('en-CA', {
                        weekday: 'short', month: 'short', day: 'numeric',
                      })}{' '}
                      <span className="hc-muted" style={{ fontSize: '0.75rem' }}>10:00 AM</span>
                    </td>
                    <td className="hc-muted" style={{ fontSize: '0.8rem' }}>
                      {p.finalized_at
                        ? new Date(p.finalized_at).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
