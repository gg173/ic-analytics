import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../homecare/hooks/useAuth';
import { useRules } from '../homecare/hooks/useRules';
import { supabase } from '../lib/supabase';

type Tab = 'care_streams' | 'title_discipline' | 'virtual' | 'status' | 'cancellations' | 'duration' | 'push';

export function HomecareAdminPage() {
  const { canManageHomecareRules } = useAuth();
  const {
    careStreams,
    titleDiscipline,
    virtualVisit,
    statusBillable,
    cancellationReasons,
    durationBounds,
    pushDestinations,
    refresh,
  } = useRules();
  const [tab, setTab] = useState<Tab>('care_streams');
  const [message, setMessage] = useState<string | null>(null);

  if (!canManageHomecareRules) return <Navigate to="/homecare" replace />;

  const tabs: { id: Tab; label: string }[] = [
    { id: 'care_streams', label: 'Care streams' },
    { id: 'title_discipline', label: 'Title / Discipline' },
    { id: 'virtual', label: 'Virtual visits' },
    { id: 'status', label: 'Billable status' },
    { id: 'cancellations', label: 'Cancellations' },
    { id: 'duration', label: 'Duration bounds' },
    { id: 'push', label: 'Push destinations' },
  ];

  return (
    <div className="hc-page">
      <h1>Rules administration</h1>
      <p className="hc-muted">Configure validation rules without redeploying the app.</p>
      {message && <p className="hc-info">{message}</p>}

      <div className="hc-filter-bar">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`hc-chip${tab === t.id ? ' hc-chip--active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'care_streams' && (
        <RulesTable
          title="Care streams"
          columns={['code', 'name', 'visit_limit', 'period_days', 'active']}
          rows={careStreams as unknown as { id?: string; [key: string]: unknown }[]}
          onAdd={async (row) => {
            await supabase.from('care_streams').insert(row);
            await refresh();
            setMessage('Care stream added');
          }}
          onDelete={async (id) => {
            await supabase.from('care_streams').delete().eq('id', id);
            await refresh();
          }}
        />
      )}

      {tab === 'title_discipline' && (
        <RulesTable
          title="Title / Discipline mappings"
          columns={['employee_title', 'employee_discipline', 'active']}
          rows={titleDiscipline as unknown as { id?: string; [key: string]: unknown }[]}
          onAdd={async (row) => {
            await supabase.from('rule_title_discipline_map').insert(row);
            await refresh();
          }}
          onDelete={async (id) => {
            await supabase.from('rule_title_discipline_map').delete().eq('id', id);
            await refresh();
          }}
        />
      )}

      {tab === 'virtual' && (
        <RulesTable
          title="Virtual visit approval rules"
          columns={['employee_discipline', 'visit_type_pattern', 'active']}
          rows={virtualVisit as unknown as { id?: string; [key: string]: unknown }[]}
          onAdd={async (row) => {
            await supabase.from('rule_virtual_visit_approval').insert(row);
            await refresh();
          }}
          onDelete={async (id) => {
            await supabase.from('rule_virtual_visit_approval').delete().eq('id', id);
            await refresh();
          }}
        />
      )}

      {tab === 'status' && (
        <RulesTable
          title="Billable visit statuses"
          columns={['status_of_visit', 'counts_toward_limit', 'exportable', 'active']}
          rows={statusBillable as unknown as { id?: string; [key: string]: unknown }[]}
          onAdd={async (row) => {
            await supabase.from('rule_visit_status_billable').insert(row);
            await refresh();
          }}
          onDelete={async (id) => {
            await supabase.from('rule_visit_status_billable').delete().eq('id', id);
            await refresh();
          }}
        />
      )}

      {tab === 'cancellations' && (
        <RulesTable
          title="Cancellation reasons"
          columns={['reason_code', 'requires_investigation', 'default_billable', 'default_payable', 'active']}
          rows={cancellationReasons as unknown as { id?: string; [key: string]: unknown }[]}
          onAdd={async (row) => {
            await supabase.from('rule_cancellation_reasons').insert(row);
            await refresh();
          }}
          onDelete={async (id) => {
            await supabase.from('rule_cancellation_reasons').delete().eq('id', id);
            await refresh();
          }}
        />
      )}

      {tab === 'duration' && durationBounds && (
        <div className="hc-panel">
          <h2>Duration bounds (minutes)</h2>
          <form
            className="hc-form hc-form--inline"
            onSubmit={async (e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              await supabase
                .from('rule_duration_bounds')
                .update({
                  min_minutes: parseInt(String(fd.get('min')), 10),
                  max_minutes: parseInt(String(fd.get('max')), 10),
                })
                .eq('id', durationBounds.id);
              await refresh();
              setMessage('Duration bounds updated');
            }}
          >
            <label>
              Min
              <input name="min" type="number" defaultValue={durationBounds.min_minutes} />
            </label>
            <label>
              Max
              <input name="max" type="number" defaultValue={durationBounds.max_minutes} />
            </label>
            <button type="submit" className="hc-btn hc-btn-primary">
              Save
            </button>
          </form>
        </div>
      )}

      {tab === 'push' && (
        <RulesTable
          title="Push destinations"
          columns={['name', 'destination_type', 'url', 'active']}
          rows={pushDestinations as unknown as { id?: string; [key: string]: unknown }[]}
          onAdd={async (row) => {
            await supabase.from('push_destinations').insert(row);
            await refresh();
          }}
          onDelete={async (id) => {
            await supabase.from('push_destinations').delete().eq('id', id);
            await refresh();
          }}
        />
      )}
    </div>
  );
}

function RulesTable({
  title,
  columns,
  rows,
  onAdd,
  onDelete,
}: {
  title: string;
  columns: string[];
  rows: { id?: string; [key: string]: unknown }[] | Record<string, unknown>[];
  onAdd: (row: Record<string, unknown>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [newRow, setNewRow] = useState<Record<string, string>>({});

  return (
    <div className="hc-panel">
      <h2>{title}</h2>
      <div className="hc-table-wrap">
        <table className="hc-table">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c}>{c}</th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={String(row.id)}>
                {columns.map((c) => (
                  <td key={c}>{String(row[c] ?? '')}</td>
                ))}
                <td>
                  <button
                    type="button"
                    className="hc-btn hc-btn-ghost"
                    onClick={() => onDelete(String(row.id))}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="hc-add-row">
        {columns.map((c) => (
          <input
            key={c}
            placeholder={c}
            value={newRow[c] ?? ''}
            onChange={(e) => setNewRow({ ...newRow, [c]: e.target.value })}
          />
        ))}
        <button
          type="button"
          className="hc-btn hc-btn-primary"
          onClick={async () => {
            const payload: Record<string, unknown> = {};
            for (const c of columns) {
              const v = newRow[c];
              if (v === 'true' || v === 'false') payload[c] = v === 'true';
              else if (c.includes('limit') || c.includes('minutes') || c.includes('days'))
                payload[c] = parseInt(v, 10) || 0;
              else payload[c] = v;
            }
            await onAdd(payload);
            setNewRow({});
          }}
        >
          Add
        </button>
      </div>
    </div>
  );
}
