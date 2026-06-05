import { useState } from 'react';
import {
  useDurationRules,
  useCancellationCodes,
  useCareStreams,
} from '../hooks/useBillingRules';
import {
  VISIT_CATEGORY_LABELS,
  DISCIPLINE_GROUP_LABELS,
  type VisitCategory,
} from '../types';

type RulesSection = 'duration' | 'cancellation_codes' | 'care_streams';

const SECTION_LABELS: Record<RulesSection, string> = {
  duration:           'Duration Limits',
  cancellation_codes: 'Cancellation Codes',
  care_streams:       'Care Streams',
};

interface RulesTabProps {
  canEditRules: boolean;
}

function SectionNav({
  active,
  onChange,
}: {
  active: RulesSection;
  onChange: (s: RulesSection) => void;
}) {
  return (
    <nav className="hc-strategy-tabs hc-strategy-tabs--below-title" aria-label="Rules sections">
      <div className="hc-strategy-tabs-list">
        {(Object.keys(SECTION_LABELS) as RulesSection[]).map((key) => (
          <button
            key={key}
            type="button"
            className={`hc-strategy-tab${active === key ? ' hc-strategy-tab--active' : ''}`}
            onClick={() => onChange(key)}
          >
            {SECTION_LABELS[key]}
          </button>
        ))}
      </div>
    </nav>
  );
}

function EffectiveDate({ from, to }: { from: string; to: string | null }) {
  const fmt = (d: string) =>
    new Date(`${d}T12:00:00`).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
  return (
    <span className="hc-muted" style={{ fontSize: '0.78rem' }}>
      {fmt(from)}{to ? ` – ${fmt(to)}` : ' → present'}
    </span>
  );
}

function ActiveBadge({ to }: { to: string | null }) {
  const isActive = to === null || new Date(to) > new Date();
  return (
    <span className={`hc-badge ${isActive ? 'hc-badge--ready_for_spo' : 'hc-badge--draft'}`}>
      {isActive ? 'Active' : 'Superseded'}
    </span>
  );
}

// ── Duration limits ───────────────────────────────────────────────────────────

function DurationRulesPanel({ canEdit }: { canEdit: boolean }) {
  const { rules, loading, error } = useDurationRules();

  // Group by visit category — show latest active rule per category prominently
  const byCategory = (['in_person', 'phone', 'virtual'] as VisitCategory[]).map((cat) => ({
    category: cat,
    rules: rules.filter((r) => r.visit_category === cat),
  }));

  if (loading) return <p className="hc-muted">Loading duration rules…</p>;
  if (error) return <p className="hc-form-error">{error}</p>;

  return (
    <div className="hc-billing-rules-section">
      <div className="hc-billing-rules-section-header">
        <p className="hc-muted" style={{ margin: 0, fontSize: '0.85rem' }}>
          Duration limits determine when a completed visit triggers an Exceptional Duration investigation.
          Limits vary by visit type. Changes take effect from the specified date.
        </p>
        {canEdit && (
          <button type="button" className="hc-btn hc-btn-secondary hc-btn-sm" disabled>
            Add rule (coming soon)
          </button>
        )}
      </div>

      {byCategory.map(({ category, rules: catRules }) => (
        <div key={category} className="hc-panel hc-billing-rule-group">
          <h3 className="hc-billing-rule-group-title">{VISIT_CATEGORY_LABELS[category]}</h3>
          {catRules.length === 0 ? (
            <p className="hc-muted">No rules configured.</p>
          ) : (
            <table className="hc-table hc-table--grid">
              <thead>
                <tr>
                  <th>Min (min)</th>
                  <th>Max (min)</th>
                  <th>Effective</th>
                  <th>Status</th>
                  <th>Change reason</th>
                </tr>
              </thead>
              <tbody>
                {catRules.map((r) => (
                  <tr key={r.id}>
                    <td>{r.min_minutes}</td>
                    <td>{r.max_minutes}</td>
                    <td><EffectiveDate from={r.effective_from} to={r.effective_to} /></td>
                    <td><ActiveBadge to={r.effective_to} /></td>
                    <td className="hc-muted" style={{ fontSize: '0.8rem' }}>{r.change_reason ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Cancellation codes ────────────────────────────────────────────────────────

function CancellationCodesPanel({ canEdit }: { canEdit: boolean }) {
  const { codes, loading, error } = useCancellationCodes();
  const [showSuperseded, setShowSuperseded] = useState(false);

  const activeCodes = codes.filter((c) => c.effective_to === null || new Date(c.effective_to) > new Date());
  const displayCodes = showSuperseded ? codes : activeCodes;

  if (loading) return <p className="hc-muted">Loading cancellation codes…</p>;
  if (error) return <p className="hc-form-error">{error}</p>;

  return (
    <div className="hc-billing-rules-section">
      <div className="hc-billing-rules-section-header">
        <p className="hc-muted" style={{ margin: 0, fontSize: '0.85rem' }}>
          Only visits with approved cancellation codes pass data quality checks.
          Visits with codes not on this list are flagged as data quality issues and must be corrected in Epic.
          Codes marked "Requires investigation" trigger a Service State Algorithm review.
        </p>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <label className="hc-muted" style={{ fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={showSuperseded}
              onChange={(e) => setShowSuperseded(e.target.checked)}
            />
            Show superseded
          </label>
          {canEdit && (
            <button type="button" className="hc-btn hc-btn-secondary hc-btn-sm" disabled>
              Add code (coming soon)
            </button>
          )}
        </div>
      </div>

      <div className="hc-table-wrap">
        <table className="hc-table hc-table--grid">
          <thead>
            <tr>
              <th>Code</th>
              <th>Label</th>
              <th>Requires investigation</th>
              <th>Auto: Billable</th>
              <th>Auto: Payable</th>
              <th>SPO Perform</th>
              <th>OH Reporting</th>
              <th>Effective</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {displayCodes.map((c) => (
              <tr key={c.id}>
                <td style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{c.code}</td>
                <td>{c.label}</td>
                <td style={{ textAlign: 'center' }}>
                  {c.requires_investigation
                    ? <span className="hc-badge hc-badge--in_review">Yes</span>
                    : <span className="hc-muted">—</span>}
                </td>
                <td style={{ textAlign: 'center' }}>{c.auto_billable === null ? <span className="hc-muted">Human</span> : c.auto_billable ? '✓' : '✗'}</td>
                <td style={{ textAlign: 'center' }}>{c.auto_payable === null ? <span className="hc-muted">Human</span> : c.auto_payable ? '✓' : '✗'}</td>
                <td style={{ textAlign: 'center' }}>{c.spo_perform === null ? <span className="hc-muted">Human</span> : c.spo_perform ? '✓' : '✗'}</td>
                <td style={{ textAlign: 'center' }}>{c.oh_reporting === null ? <span className="hc-muted">Human</span> : c.oh_reporting ? '✓' : '✗'}</td>
                <td><EffectiveDate from={c.effective_from} to={c.effective_to} /></td>
                <td><ActiveBadge to={c.effective_to} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Care streams ──────────────────────────────────────────────────────────────

function CareStreamsPanel({ canEdit }: { canEdit: boolean }) {
  const { streams, loading, error } = useCareStreams();

  if (loading) return <p className="hc-muted">Loading care streams…</p>;
  if (error) return <p className="hc-form-error">{error}</p>;

  const nursingStreams = streams.filter((s) => s.discipline_group === 'nursing_psw');
  const rehabStreams   = streams.filter((s) => s.discipline_group === 'rehab');

  const StreamTable = ({ rows }: { rows: typeof streams }) => (
    rows.length === 0
      ? <p className="hc-muted">No care streams configured.</p>
      : (
        <table className="hc-table hc-table--grid">
          <thead>
            <tr>
              <th>Code</th>
              <th>Label</th>
              <th>Max visits</th>
              <th>Period (days)</th>
              <th>Effective</th>
              <th>Status</th>
              <th>Change reason</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id}>
                <td style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{s.code}</td>
                <td>{s.label}</td>
                <td>{s.max_visits}</td>
                <td>{s.period_days}</td>
                <td><EffectiveDate from={s.effective_from} to={s.effective_to} /></td>
                <td><ActiveBadge to={s.effective_to} /></td>
                <td className="hc-muted" style={{ fontSize: '0.8rem' }}>{s.change_reason ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )
  );

  return (
    <div className="hc-billing-rules-section">
      <div className="hc-billing-rules-section-header">
        <p className="hc-muted" style={{ margin: 0, fontSize: '0.85rem' }}>
          Care streams define the maximum number of visits a patient is allocated over their episode.
          Visits beyond the limit trigger a Care Stream Excess investigation.
        </p>
        {canEdit && (
          <button type="button" className="hc-btn hc-btn-secondary hc-btn-sm" disabled>
            Add care stream (coming soon)
          </button>
        )}
      </div>

      <div className="hc-panel hc-billing-rule-group">
        <h3 className="hc-billing-rule-group-title">{DISCIPLINE_GROUP_LABELS['nursing_psw']}</h3>
        <StreamTable rows={nursingStreams} />
      </div>
      <div className="hc-panel hc-billing-rule-group">
        <h3 className="hc-billing-rule-group-title">{DISCIPLINE_GROUP_LABELS['rehab']}</h3>
        <StreamTable rows={rehabStreams} />
      </div>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export function RulesTab({ canEditRules }: RulesTabProps) {
  const [activeSection, setActiveSection] = useState<RulesSection>('duration');

  return (
    <div className="hc-billing-rules">
      <div className="hc-billing-rules-header">
        <div>
          <h2 className="hc-page-header" style={{ margin: 0 }}>
            <h1 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600 }}>Business Rules Repository</h1>
          </h2>
          <p className="hc-muted" style={{ marginTop: '0.25rem', fontSize: '0.85rem' }}>
            Rules drive automated billing classification. Changes take effect from the specified date and are fully audited.
            {canEditRules ? '' : ' Contact a UHN Admin to request changes.'}
          </p>
        </div>
      </div>

      <SectionNav active={activeSection} onChange={setActiveSection} />

      <div className="hc-billing-rules-content">
        {activeSection === 'duration'           && <DurationRulesPanel canEdit={canEditRules} />}
        {activeSection === 'cancellation_codes' && <CancellationCodesPanel canEdit={canEditRules} />}
        {activeSection === 'care_streams'       && <CareStreamsPanel canEdit={canEditRules} />}
      </div>
    </div>
  );
}
