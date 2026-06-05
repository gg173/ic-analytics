import { useState, useEffect, useCallback, type MouseEvent } from 'react';
import { supabase } from '../../lib/supabase';
import type {
  BillingVisit, DataQualityIssue, BillingInvestigation,
  InvestigationOutcome,
} from '../types';
import { INVESTIGATION_TYPE_LABELS, INVESTIGATION_STATUS_LABELS, VISIT_CATEGORY_LABELS } from '../types';
import type { Profile } from '../../homecare/types';

// ── Why-flagged explanations ──────────────────────────────────────────────────

interface DurationRule {
  min_minutes: number;
  max_minutes: number;
  visit_category: string;
}

function buildInvestigationReason(
  inv: BillingInvestigation,
  visit: BillingVisit,
  durationRule?: DurationRule | null
): { headline: string; detail: string } {
  switch (inv.investigation_type) {
    case 'exceptional_duration': {
      const dur     = visit.duration_minutes;
      const cat     = visit.visit_category ? VISIT_CATEGORY_LABELS[visit.visit_category] : 'this visit type';
      const min     = durationRule?.min_minutes ?? '—';
      const max     = durationRule?.max_minutes ?? '—';
      const tooLong = dur != null && durationRule && dur > durationRule.max_minutes;
      const dir     = tooLong ? 'exceeds the maximum' : 'is below the minimum';
      return {
        headline: `Duration of ${dur ?? '?'} min ${dir} for ${cat} visits`,
        detail:   `Expected range for ${cat} visits is ${min}–${max} minutes. ` +
                  `An unusual duration may indicate a data entry error in Epic, or it may be legitimate ` +
                  `(e.g., a complex visit that ran long). The investigation must confirm which applies ` +
                  `and record the outcome.`,
      };
    }
    case 'service_state': {
      const code  = visit.visit_cancel_reason ?? '(none)';
      const vstatus = visit.status_of_visit ?? 'unknown';
      return {
        headline: `Visit status "${vstatus}" requires Service State Algorithm review`,
        detail:   `Cancel/status code "${code}" requires human adjudication to determine billability ` +
                  `and payability. Walk through the Service State Algorithm: Was F2F contact made? ` +
                  `Was care delivered? What was the reason for non-delivery? The answers determine ` +
                  `the correct cancel code, whether the visit is billable, payable, and whether ` +
                  `OH reporting is required.`,
      };
    }
    case 'care_stream_excess': {
      const stream = visit.care_stream ?? 'unknown';
      return {
        headline: `Visit may exceed the patient's care stream allocation`,
        detail:   `Patient (MRN ${visit.mrn ?? '—'}) is on care stream "${stream}". ` +
                  `Including this visit, the patient may have exceeded the maximum number of visits ` +
                  `allowed under their allocation. Confirm whether an extension or exception has been ` +
                  `approved. If yes, the visit is billable; if no, it is not.`,
      };
    }
    case 'virtual_visit_approval': {
      const disc = visit.employee_discipline ?? 'this discipline';
      return {
        headline: `Virtual visit by ${disc} requires approval documentation`,
        detail:   `Virtual visits by ${disc} clinicians require documented approval before billing. ` +
                  `Confirm that the approval has been obtained and recorded. If approved, the visit ` +
                  `is billable; if not approved, it is not billable.`,
      };
    }
    default:
      return { headline: 'Investigation required', detail: 'Review visit details and record a determination.' };
  }
}

// ── DQ issue explanation ──────────────────────────────────────────────────────

function buildDqReason(issue: DataQualityIssue): { headline: string; detail: string; action: string } {
  switch (issue.issue_type) {
    case 'invalid_cancel_code':
      return {
        headline: `Unrecognised cancel code: "${issue.field_value ?? '—'}"`,
        detail:   `This cancel code is not in the approved list. The visit cannot be classified until a valid code is applied.`,
        action:   `Correct the cancel code in Epic. The fix will arrive automatically in the next daily flat file upload.`,
      };
    case 'missing_cancel_code':
      return {
        headline: 'Cancelled visit has no cancel code',
        detail:   'This visit is marked Cancelled but no cancellation reason code has been entered in Epic.',
        action:   'Add the appropriate cancel code in Epic. It will arrive in the next flat file upload.',
      };
    case 'missing_csn':
      return {
        headline: 'Visit has no CSN (encounter number)',
        detail:   'Without a CSN this row cannot be uniquely identified or tracked across uploads.',
        action:   'Verify the row in Epic and ensure a CSN is present.',
      };
    default:
      return {
        headline: issue.issue_type.replace(/_/g, ' '),
        detail:   issue.message,
        action:   'Correct the issue in Epic.',
      };
  }
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

function useVisitDetail(visitId: string) {
  const [dqIssues, setDqIssues]             = useState<DataQualityIssue[]>([]);
  const [investigations, setInvestigations] = useState<BillingInvestigation[]>([]);
  const [durationRule, setDurationRule]     = useState<DurationRule | null>(null);
  const [loading, setLoading]               = useState(true);
  const [refreshKey, setRefreshKey]         = useState(0);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    setLoading(true);
    void Promise.all([
      supabase.from('data_quality_issues').select('*').eq('visit_id', visitId),
      supabase.from('billing_investigations').select('*').eq('visit_id', visitId),
    ]).then(([dqRes, invRes]) => {
      setDqIssues((dqRes.data ?? []) as DataQualityIssue[]);
      setInvestigations((invRes.data ?? []) as BillingInvestigation[]);
      setLoading(false);
    });
  }, [visitId, refreshKey]);

  // Load applicable duration rule for this visit's category
  useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from('billing_duration_rules')
        .select('min_minutes, max_minutes, visit_category')
        .is('effective_to', null)
        .limit(10);
      setDurationRule((data ?? []) as unknown as DurationRule | null);
    })();
  }, []);

  return { dqIssues, investigations, durationRule, loading, refresh };
}

// ── Determination form ────────────────────────────────────────────────────────

function DeterminationForm({
  investigation,
  visit,
  profile,
  canEdit,
  onSaved,
}: {
  investigation: BillingInvestigation;
  visit: BillingVisit;
  profile: Profile | null;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const [outcome, setOutcome]     = useState<'billable' | 'not_billable' | ''>('');
  const [rationale, setRationale] = useState('');
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState<string | null>(null);

  const isAlreadyClosed = investigation.status === 'closed';

  const handleSave = async () => {
    if (!outcome || !rationale.trim()) return;
    if (!profile?.user_id) return;
    setSaving(true);
    setError(null);

    // Update investigation
    const { error: invErr } = await supabase
      .from('billing_investigations')
      .update({
        status:           'closed',
        outcome:          outcome as InvestigationOutcome,
        outcome_rationale: rationale.trim(),
        signed_off_by:    profile.user_id,
        signed_off_at:    new Date().toISOString(),
        updated_at:       new Date().toISOString(),
      })
      .eq('id', investigation.id);

    if (invErr) { setError(invErr.message); setSaving(false); return; }

    // Update visit billing_status
    const { error: visitErr } = await supabase
      .from('service_visits')
      .update({
        billing_status:    outcome,
        investigation_flag: false,
        updated_at:         new Date().toISOString(),
      })
      .eq('id', visit.id);

    if (visitErr) { setError(visitErr.message); setSaving(false); return; }

    onSaved();
    setSaving(false);
  };

  if (isAlreadyClosed) {
    return (
      <div className="hc-billing-determination hc-billing-determination--closed">
        <div className="hc-billing-determination-outcome">
          <span className={`hc-badge hc-badge--lg ${investigation.outcome === 'billable' ? 'hc-badge--ready_for_spo' : 'hc-badge--pushed'}`}>
            {investigation.outcome === 'billable' ? '✓ Billable' : '✗ Not Billable'}
          </span>
        </div>
        <div className="hc-billing-determination-rationale">
          <p className="hc-billing-review-section-title">Rationale</p>
          <p className="hc-billing-determination-rationale-text">{investigation.outcome_rationale ?? '—'}</p>
        </div>
        {investigation.signed_off_at && (
          <p className="hc-muted" style={{ fontSize: '0.72rem', marginTop: '0.25rem' }}>
            Signed off {new Date(investigation.signed_off_at).toLocaleDateString('en-CA', {
              month: 'short', day: 'numeric', year: 'numeric',
            })}
          </p>
        )}
      </div>
    );
  }

  if (!canEdit) {
    return (
      <p className="hc-muted" style={{ fontSize: '0.82rem' }}>
        Awaiting determination by a reviewer.
      </p>
    );
  }

  return (
    <div className="hc-billing-determination">
      <p className="hc-billing-review-section-title">Record determination</p>
      <p className="hc-muted" style={{ fontSize: '0.78rem', marginBottom: '0.75rem' }}>
        All investigations must be resolved as Billable or Not Billable before this week can be finalized.
        Your determination and rationale will be permanently logged.
      </p>

      <div className="hc-billing-determination-options">
        <button
          type="button"
          className={`hc-billing-determination-option hc-billing-determination-option--billable${outcome === 'billable' ? ' hc-billing-determination-option--selected' : ''}`}
          onClick={() => setOutcome('billable')}
        >
          <span className="hc-billing-determination-option-icon">✓</span>
          Billable
        </button>
        <button
          type="button"
          className={`hc-billing-determination-option hc-billing-determination-option--not-billable${outcome === 'not_billable' ? ' hc-billing-determination-option--selected' : ''}`}
          onClick={() => setOutcome('not_billable')}
        >
          <span className="hc-billing-determination-option-icon">✗</span>
          Not Billable
        </button>
      </div>

      <div style={{ marginTop: '0.75rem' }}>
        <label className="hc-billing-determination-label" htmlFor={`rationale-${investigation.id}`}>
          Rationale <span style={{ color: '#b91c1c' }}>*</span>
        </label>
        <textarea
          id={`rationale-${investigation.id}`}
          className="hc-billing-determination-textarea"
          placeholder="Explain the basis for this determination. This will appear in the backing sheet submitted to VHA."
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
          rows={4}
        />
      </div>

      {error && <p className="hc-form-error" style={{ fontSize: '0.78rem' }}>{error}</p>}

      <div style={{ marginTop: '0.75rem', display: 'flex', justifyContent: 'flex-end' }}>
        <button
          type="button"
          className="hc-btn hc-btn-primary"
          disabled={!outcome || !rationale.trim() || saving}
          onClick={() => void handleSave()}
        >
          {saving ? 'Saving…' : 'Sign off & close investigation'}
        </button>
      </div>
    </div>
  );
}

// ── Main modal ────────────────────────────────────────────────────────────────

interface ReviewModalProps {
  visit: BillingVisit;
  onClose: () => void;
  onDetermined: () => void;
  canEdit: boolean;
  profile: Profile | null;
}

export function ReviewModal({ visit, onClose, onDetermined, canEdit, profile }: ReviewModalProps) {
  const { dqIssues, investigations, durationRule, loading, refresh } = useVisitDetail(visit.id);
  const employeeName = [visit.employee_first, visit.employee_last].filter(Boolean).join(' ') || '—';

  const handleBackdrop = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  const handleSaved = () => {
    refresh();
    onDetermined();
  };

  // Find the applicable duration rule for this visit's category
  const applicableDurationRule = Array.isArray(durationRule)
    ? (durationRule as DurationRule[]).find((r) => r.visit_category === visit.visit_category) ?? null
    : durationRule;

  return (
    <div className="hc-billing-modal-backdrop" onClick={handleBackdrop} role="dialog" aria-modal aria-label="Visit review">
      <div className="hc-billing-modal">

        {/* Header */}
        <div className="hc-billing-modal-header">
          <div>
            <h2 className="hc-billing-modal-title">{employeeName}</h2>
            <p className="hc-muted" style={{ margin: 0, fontSize: '0.78rem' }}>
              {visit.service_date} · {visit.visit_type ?? '—'} · MRN {visit.mrn ?? '—'}
            </p>
          </div>
          <button type="button" className="hc-btn hc-btn-ghost hc-modal-close" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="hc-billing-modal-body">
          {loading && <p className="hc-muted" style={{ fontSize: '0.82rem' }}>Loading…</p>}

          {/* Visit summary */}
          <div className="hc-billing-review-section">
            <p className="hc-billing-review-section-title">Visit details</p>
            <dl className="hc-billing-review-dl hc-billing-review-dl--two-col">
              <dt>Visit status</dt><dd>{visit.status_of_visit ?? '—'}</dd>
              <dt>Duration</dt><dd>{visit.duration_minutes != null ? `${visit.duration_minutes} min` : '—'}</dd>
              <dt>Discipline</dt><dd>{visit.employee_discipline ?? '—'} · {visit.employee_title ?? '—'}</dd>
              <dt>Visit type</dt><dd>{visit.visit_type ?? '—'}</dd>
              <dt>Bill to</dt><dd>{visit.bill_to_code ?? '—'}</dd>
              {visit.care_stream && <><dt>Care stream</dt><dd>{visit.care_stream}</dd></>}
              {visit.visit_cancel_reason && <><dt>Cancel code</dt><dd>{visit.visit_cancel_reason}</dd></>}
              {visit.visit_cancel_reason_description && <><dt>Cancel notes</dt><dd>{visit.visit_cancel_reason_description}</dd></>}
            </dl>
          </div>

          {/* Data quality issues */}
          {!loading && dqIssues.map((issue) => {
            const { headline, detail, action } = buildDqReason(issue);
            return (
              <div key={issue.id} className="hc-billing-review-section">
                <p className="hc-billing-review-section-title hc-billing-review-section-title--dq">
                  Data quality issue
                </p>
                <div className="hc-billing-investigation-card hc-billing-investigation-card--dq">
                  <p className="hc-billing-investigation-headline">{headline}</p>
                  <p className="hc-billing-investigation-detail">{detail}</p>
                  <div className="hc-billing-investigation-action-box">
                    <span className="hc-billing-investigation-action-label">Required action</span>
                    <p className="hc-billing-investigation-action-text">{action}</p>
                  </div>
                  <div style={{ marginTop: '0.5rem' }}>
                    <span className={`hc-badge ${issue.status === 'resolved' ? 'hc-badge--ready_for_spo' : 'hc-badge--in_review'}`}>
                      {issue.status === 'resolved' ? 'Resolved' : 'Open — awaiting Epic correction'}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}

          {/* Investigations */}
          {!loading && investigations.map((inv) => {
            const { headline, detail } = buildInvestigationReason(inv, visit, applicableDurationRule);
            const isClosed = inv.status === 'closed';
            return (
              <div key={inv.id} className="hc-billing-review-section">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <p className="hc-billing-review-section-title hc-billing-review-section-title--inv" style={{ margin: 0 }}>
                    {INVESTIGATION_TYPE_LABELS[inv.investigation_type]}
                  </p>
                  <span className={`hc-badge ${
                    isClosed                   ? (inv.outcome === 'billable' ? 'hc-badge--ready_for_spo' : 'hc-badge--pushed') :
                    inv.status === 'in_progress'  ? 'hc-badge--validated' :
                    inv.status === 'pending_info' ? 'hc-badge--in_review'  :
                    'hc-badge--draft'
                  }`}>
                    {isClosed
                      ? (inv.outcome === 'billable' ? '✓ Billable' : '✗ Not Billable')
                      : INVESTIGATION_STATUS_LABELS[inv.status]}
                  </span>
                </div>

                {/* Why flagged */}
                <div className="hc-billing-investigation-card hc-billing-investigation-card--inv">
                  <p className="hc-billing-investigation-headline">{headline}</p>
                  <p className="hc-billing-investigation-detail">{detail}</p>
                </div>

                {/* Determination form or result */}
                <div style={{ marginTop: '0.75rem' }}>
                  <DeterminationForm
                    investigation={inv}
                    visit={visit}
                    profile={profile}
                    canEdit={canEdit}
                    onSaved={handleSaved}
                  />
                </div>
              </div>
            );
          })}

          {!loading && dqIssues.length === 0 && investigations.length === 0 && (
            <p className="hc-muted" style={{ fontSize: '0.82rem' }}>No issues on record for this visit.</p>
          )}
        </div>

        <div className="hc-billing-modal-footer">
          <button type="button" className="hc-btn hc-btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
