import { useState, useEffect, useCallback } from 'react';
import type {
  PayPeriod, BillingVisit, BillingStatus, InvestigationType,
} from '../types';
import {
  VISIT_CATEGORY_LABELS,
  formatWeekLabel,
} from '../types';
import { supabase } from '../../lib/supabase';
import { finalizePayPeriod } from '../hooks/usePayPeriods';
import { ReviewModal } from './ReviewModal';
import type { Profile } from '../../homecare/types';

interface WeekWorkspaceProps {
  weekStart: string;
  payPeriod: PayPeriod | null;
  canEdit: boolean;
  profile: Profile | null;
  onRefresh: () => Promise<void>;
}

type VisitFilter =
  | 'all'
  | 'data_quality'
  | 'needs_investigation'
  | 'clean'
  | 'billable'
  | 'not_billable'
  | 'pending';

const STATUS_FILTER_LABELS: { key: VisitFilter; label: string }[] = [
  { key: 'all',                 label: 'All' },
  { key: 'needs_investigation', label: 'Investigations' },
  { key: 'data_quality',        label: 'Data Quality' },
  { key: 'clean',               label: 'Clean' },
  { key: 'billable',            label: 'Billable' },
  { key: 'not_billable',        label: 'Not Billable' },
  { key: 'pending',             label: 'Pending' },
];

// Short labels for investigation subcategories shown inline in the table
const INV_TYPE_SHORT: Record<InvestigationType, string> = {
  exceptional_duration:   'Duration',
  service_state:          'Service State',
  care_stream_excess:     'Visit Limit',
  virtual_visit_approval: 'Virtual Approval',
};

const DQ_TYPE_SHORT: Record<string, string> = {
  invalid_cancel_code: 'Invalid cancel code',
  missing_cancel_code: 'Missing cancel code',
  missing_csn:         'Missing CSN',
};

// ── Per-visit flag summary (loaded alongside visits) ──────────────────────────

interface VisitFlags {
  invTypes: InvestigationType[];
  dqTypes: string[];
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

function usePayPeriodData(payPeriodId: string | undefined) {
  const [visits, setVisits]           = useState<BillingVisit[]>([]);
  const [flagMap, setFlagMap]         = useState<Map<string, VisitFlags>>(new Map());
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!payPeriodId) { setVisits([]); setFlagMap(new Map()); return; }
    setLoading(true);

    const [visitsRes, invRes, dqRes] = await Promise.all([
      supabase
        .from('service_visits')
        .select('*')
        .eq('pay_period_id', payPeriodId)
        .order('service_date', { ascending: true })
        .order('employee_last', { ascending: true }),
      supabase
        .from('billing_investigations')
        .select('visit_id, investigation_type')
        .eq('pay_period_id', payPeriodId),
      supabase
        .from('data_quality_issues')
        .select('visit_id, issue_type')
        .eq('pay_period_id', payPeriodId),
    ]);

    if (visitsRes.error) { setError(visitsRes.error.message); setLoading(false); return; }

    // Build flag map: visit_id → { invTypes[], dqTypes[] }
    const map = new Map<string, VisitFlags>();
    const ensure = (id: string) => {
      if (!map.has(id)) map.set(id, { invTypes: [], dqTypes: [] });
      return map.get(id)!;
    };
    for (const r of invRes.data ?? []) ensure(r.visit_id as string).invTypes.push(r.investigation_type as InvestigationType);
    for (const r of dqRes.data  ?? []) ensure(r.visit_id as string).dqTypes.push(r.issue_type as string);

    setVisits((visitsRes.data ?? []) as BillingVisit[]);
    setFlagMap(map);
    setLoading(false);
  }, [payPeriodId]);

  useEffect(() => { void load(); }, [load]);
  return { visits, flagMap, loading, error, refresh: load };
}

// ── Status cell: badge + subcategory reasons ──────────────────────────────────

function StatusCell({ visit, flags }: { visit: BillingVisit; flags: VisitFlags | undefined }) {
  const status = visit.billing_status;

  const badgeCls =
    status === 'clean'               ? 'hc-badge--validated'    :
    status === 'billable'            ? 'hc-badge--ready_for_spo':
    status === 'not_billable'        ? 'hc-badge--pushed'       :
    status === 'data_quality'        ? 'hc-badge--in_review'    :
    status === 'needs_investigation' ? 'hc-badge--in_review'    :
    'hc-badge--draft';

  const reasons: string[] = [];
  if (status === 'needs_investigation' && flags?.invTypes.length) {
    reasons.push(...flags.invTypes.map((t) => INV_TYPE_SHORT[t] ?? t));
  }
  if (status === 'data_quality' && flags?.dqTypes.length) {
    reasons.push(...flags.dqTypes.map((t) => DQ_TYPE_SHORT[t] ?? t.replace(/_/g, ' ')));
  }

  const label =
    status === 'clean'               ? 'Clean'            :
    status === 'billable'            ? 'Billable'         :
    status === 'not_billable'        ? 'Not Billable'     :
    status === 'data_quality'        ? 'Data Quality'     :
    status === 'needs_investigation' ? 'Investigation'    :
    'Pending';

  return (
    <div className="hc-billing-status-cell">
      <span className={`hc-badge hc-billing-status-badge ${badgeCls}`}>{label}</span>
      {reasons.map((r) => (
        <span key={r} className="hc-billing-status-reason">{r}</span>
      ))}
    </div>
  );
}

// ── Main workspace ────────────────────────────────────────────────────────────

export function WeekWorkspace({ weekStart, payPeriod, canEdit, profile, onRefresh }: WeekWorkspaceProps) {
  const [visitFilter, setVisitFilter]     = useState<VisitFilter>('all');
  const [selectedVisit, setSelectedVisit] = useState<BillingVisit | null>(null);
  const [finalizing, setFinalizing]       = useState(false);
  const [finalizeError, setFinalizeError] = useState<string | null>(null);

  const { visits, flagMap, loading: visitsLoading, error: visitsError } = usePayPeriodData(payPeriod?.id);

  const weekLabel   = formatWeekLabel(weekStart);
  const isFinalized = payPeriod?.status === 'finalized';
  const isInProgress = payPeriod?.status === 'in_progress';
  const isNotStarted = !payPeriod || payPeriod.status === 'not_started';

  const counts = visits.reduce((acc, v) => {
    acc[v.billing_status] = (acc[v.billing_status] ?? 0) + 1;
    return acc;
  }, {} as Partial<Record<BillingStatus, number>>);
  const total = visits.length;

  const filteredVisits = visitFilter === 'all'
    ? visits
    : visits.filter((v) => v.billing_status === visitFilter);

  const canFinalize =
    isInProgress && visits.length > 0 &&
    !counts['data_quality'] && !counts['needs_investigation'] && !counts['pending'];

  const handleFinalize = async () => {
    if (!payPeriod?.id || !profile?.user_id || !canEdit) return;
    if (!window.confirm(`Finalize week of ${weekLabel}?\n\nThis locks all records. It cannot be undone.`)) return;
    setFinalizing(true);
    setFinalizeError(null);
    const { error } = await finalizePayPeriod(payPeriod.id, profile.user_id);
    if (error) setFinalizeError(error);
    else await onRefresh();
    setFinalizing(false);
  };

  const pendingCount = (counts['data_quality'] ?? 0) + (counts['needs_investigation'] ?? 0) + (counts['pending'] ?? 0);

  const workspaceContent = (
    <div className="hc-billing-workspace-inner">
      <div className="hc-billing-workspace-header">
        <div>
          <h3 className="hc-panel-title" style={{ margin: 0 }}>{weekLabel}</h3>
          {!isNotStarted && (
            <p className="hc-muted" style={{ marginTop: '0.15rem', fontSize: '0.78rem' }}>
              {total} visit{total !== 1 ? 's' : ''}
              {pendingCount > 0 && isInProgress && (
                <span style={{ color: '#b91c1c', marginLeft: '0.5rem' }}>
                  · {pendingCount} need{pendingCount === 1 ? 's' : ''} attention
                </span>
              )}
            </p>
          )}
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {isFinalized   && <span className="hc-badge hc-badge--ready_for_spo">Finalized</span>}
          {isInProgress  && <span className="hc-badge hc-badge--in_review">In Progress</span>}
          {isNotStarted  && <span className="hc-badge hc-badge--draft">Not started</span>}
          {canEdit && isInProgress && (
            <button
              type="button"
              className={`hc-btn hc-btn-sm ${canFinalize ? 'hc-btn-success' : 'hc-btn-secondary'}`}
              disabled={!canFinalize || finalizing}
              title={!canFinalize ? 'Resolve all issues and investigations first' : undefined}
              onClick={() => void handleFinalize()}
            >
              {finalizing ? 'Finalizing…' : 'Finalize Week'}
            </button>
          )}
        </div>
      </div>

      {finalizeError && <p className="hc-form-error" style={{ fontSize: '0.82rem' }}>{finalizeError}</p>}

      {isNotStarted && (
        <div className="hc-billing-upload-prompt">
          <p className="hc-muted" style={{ fontSize: '0.82rem' }}>
            No data for this week yet. Upload a visit flat file from the File Import tab —
            visits with service dates in this week will appear here automatically.
          </p>
        </div>
      )}

      {!isNotStarted && (
        <VisitTable
          visits={filteredVisits}
          flagMap={flagMap}
          loading={visitsLoading}
          error={visitsError}
          filter={visitFilter}
          counts={counts}
          total={total}
          onFilterChange={(f) => { setVisitFilter(f); setSelectedVisit(null); }}
          selectedVisitId={selectedVisit?.id ?? null}
          onSelectVisit={(v) => setSelectedVisit((prev) => prev?.id === v.id ? null : v)}
          readOnly={isFinalized}
        />
      )}
    </div>
  );

  return (
    <div className={`hc-panel hc-billing-workspace${isFinalized ? ' hc-billing-workspace--finalized' : ''}`}>
      {workspaceContent}
      {selectedVisit && (
        <ReviewModal
          visit={selectedVisit}
          onClose={() => setSelectedVisit(null)}
          onDetermined={async () => { setSelectedVisit(null); await onRefresh(); }}
          canEdit={canEdit}
          profile={profile}
        />
      )}
    </div>
  );
}

// ── Visit table ────────────────────────────────────────────────────────────────

interface VisitTableProps {
  visits: BillingVisit[];
  flagMap: Map<string, VisitFlags>;
  loading: boolean;
  error: string | null;
  filter: VisitFilter;
  counts: Partial<Record<BillingStatus, number>>;
  total: number;
  onFilterChange: (f: VisitFilter) => void;
  selectedVisitId: string | null;
  onSelectVisit: (v: BillingVisit) => void;
  readOnly: boolean;
}

function VisitTable({
  visits, flagMap, loading, error, filter, counts, total,
  onFilterChange, selectedVisitId, onSelectVisit,
}: VisitTableProps) {
  return (
    <div className="hc-billing-visit-table-wrap">
      {/* Filter chips */}
      <div className="hc-billing-visit-filters">
        {STATUS_FILTER_LABELS.map(({ key, label }) => {
          const count    = key === 'all' ? total : (counts[key as BillingStatus] ?? 0);
          const isActive = filter === key;
          return (
            <button
              key={key}
              type="button"
              className={`hc-billing-filter-chip${isActive ? ' hc-billing-filter-chip--active' : ''}`}
              onClick={() => onFilterChange(key)}
            >
              {label}
              {count > 0 && (
                <span className={`hc-strategy-tab-count${
                  key === 'data_quality' || key === 'needs_investigation' ? ' hc-billing-count--alert' : ''
                }`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {error   && <p className="hc-form-error" style={{ fontSize: '0.78rem' }}>{error}</p>}
      {loading && <p className="hc-muted" style={{ padding: '0.5rem 0', fontSize: '0.78rem' }}>Loading…</p>}

      {!loading && visits.length === 0 && (
        <p className="hc-muted" style={{ padding: '0.75rem 0', fontSize: '0.78rem' }}>No visits match this filter.</p>
      )}

      {!loading && visits.length > 0 && (
        <div className="hc-table-wrap hc-table-wrap--fill">
          <table className="hc-table hc-table--grid hc-table--compact hc-billing-visit-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>MRN</th>
                <th>Employee</th>
                <th>Title</th>
                <th>Category</th>
                <th>Visit status</th>
                <th>Dur.</th>
                <th>Cancel code</th>
                <th>Billing status</th>
              </tr>
            </thead>
            <tbody>
              {visits.map((v) => {
                const isSelected  = selectedVisitId === v.id;
                const flags       = flagMap.get(v.id);
                const needsAction = v.billing_status === 'data_quality' || v.billing_status === 'needs_investigation';
                return (
                  <tr
                    key={v.id}
                    className={[
                      isSelected  ? 'hc-row--selected' : '',
                      !isSelected && v.billing_status === 'data_quality'       ? 'hc-billing-row--dq'  : '',
                      !isSelected && v.billing_status === 'needs_investigation' ? 'hc-billing-row--inv' : '',
                      needsAction ? 'hc-billing-row--clickable' : '',
                    ].filter(Boolean).join(' ')}
                    onClick={() => onSelectVisit(v)}
                    style={{ cursor: 'pointer' }}
                  >
                    <td style={{ whiteSpace: 'nowrap' }}>{v.service_date ?? '—'}</td>
                    <td>{v.mrn ?? '—'}</td>
                    <td>{[v.employee_first, v.employee_last].filter(Boolean).join(' ') || '—'}</td>
                    <td>{v.employee_title ?? '—'}</td>
                    <td>{v.visit_category ? VISIT_CATEGORY_LABELS[v.visit_category] : '—'}</td>
                    <td>{v.status_of_visit ?? '—'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {v.duration_minutes != null ? `${v.duration_minutes}m` : '—'}
                    </td>
                    <td style={{ maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {v.visit_cancel_reason ?? '—'}
                    </td>
                    <td>
                      <StatusCell visit={v} flags={flags} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
