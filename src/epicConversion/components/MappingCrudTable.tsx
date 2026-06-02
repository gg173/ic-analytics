import { useState } from 'react';
import { supabase } from '../../lib/supabase';

export type EpicMappingTableName = 'epic_icl_name_map' | 'epic_pathway_name_map';

export interface MappingCrudConfig {
  table: EpicMappingTableName;
  title: string;
  sourceColumn: string;
  targetColumn: string;
  sourceLabel: string;
  targetLabel: string;
  sourcePlaceholder: string;
  targetPlaceholder: string;
}

export interface MappingCrudRow {
  id: string;
  active: boolean;
}

interface MappingCrudTableProps {
  config: MappingCrudConfig;
  rows: readonly MappingCrudRow[];
  onRefresh: () => Promise<void>;
  onMessage: (message: string | null) => void;
}

function readRowField(row: MappingCrudRow, column: string): string {
  const value = (row as unknown as Record<string, unknown>)[column];
  return typeof value === 'string' ? value : String(value ?? '');
}

export function MappingCrudTable({
  config,
  rows,
  onRefresh,
  onMessage,
}: MappingCrudTableProps) {
  const [newSource, setNewSource] = useState('');
  const [newTarget, setNewTarget] = useState('');
  const [newActive, setNewActive] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editSource, setEditSource] = useState('');
  const [editTarget, setEditTarget] = useState('');
  const [editActive, setEditActive] = useState(true);
  const [saving, setSaving] = useState(false);

  const startEdit = (row: MappingCrudRow) => {
    setEditingId(row.id);
    setEditSource(readRowField(row, config.sourceColumn));
    setEditTarget(readRowField(row, config.targetColumn));
    setEditActive(row.active);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditSource('');
    setEditTarget('');
    setEditActive(true);
  };

  const runMutation = async (fn: () => Promise<void>) => {
    setSaving(true);
    onMessage(null);
    try {
      await fn();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="hc-panel">
      <h2>{config.title}</h2>
      <div className="hc-table-wrap">
        <table className="hc-table">
          <thead>
            <tr>
              <th>{config.sourceLabel}</th>
              <th>{config.targetLabel}</th>
              <th>Active</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="hc-muted">
                  No mappings yet.
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={row.id}>
                {editingId === row.id ? (
                  <>
                    <td>
                      <input
                        value={editSource}
                        onChange={(e) => setEditSource(e.target.value)}
                        aria-label={config.sourceLabel}
                        disabled={saving}
                      />
                    </td>
                    <td>
                      <input
                        value={editTarget}
                        onChange={(e) => setEditTarget(e.target.value)}
                        aria-label={config.targetLabel}
                        disabled={saving}
                      />
                    </td>
                    <td>
                      <label className="hc-checkbox-label">
                        <input
                          type="checkbox"
                          checked={editActive}
                          onChange={(e) => setEditActive(e.target.checked)}
                          disabled={saving}
                        />
                        Active
                      </label>
                    </td>
                    <td className="hc-table-actions">
                      <button
                        type="button"
                        className="hc-btn hc-btn-primary"
                        disabled={saving}
                        onClick={() =>
                          void runMutation(async () => {
                            const source = editSource.trim();
                            const target = editTarget.trim();
                            if (!source || !target) {
                              onMessage('Source and target are required.');
                              return;
                            }
                            const { error } = await supabase
                              .from(config.table)
                              .update({
                                [config.sourceColumn]: source,
                                [config.targetColumn]: target,
                                active: editActive,
                              })
                              .eq('id', row.id);
                            if (error) {
                              onMessage(error.message);
                              return;
                            }
                            cancelEdit();
                            await onRefresh();
                            onMessage('Mapping updated');
                          })
                        }
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        className="hc-btn hc-btn-ghost"
                        disabled={saving}
                        onClick={cancelEdit}
                      >
                        Cancel
                      </button>
                    </td>
                  </>
                ) : (
                  <>
                    <td>{readRowField(row, config.sourceColumn)}</td>
                    <td>{readRowField(row, config.targetColumn)}</td>
                    <td>{row.active ? 'Yes' : 'No'}</td>
                    <td className="hc-table-actions">
                      <button
                        type="button"
                        className="hc-btn hc-btn-ghost"
                        disabled={saving}
                        onClick={() => startEdit(row)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="hc-btn hc-btn-ghost"
                        disabled={saving}
                        onClick={() =>
                          void runMutation(async () => {
                            const { error } = await supabase
                              .from(config.table)
                              .update({ active: !row.active })
                              .eq('id', row.id);
                            if (error) {
                              onMessage(error.message);
                              return;
                            }
                            await onRefresh();
                            onMessage(row.active ? 'Mapping deactivated' : 'Mapping activated');
                          })
                        }
                      >
                        {row.active ? 'Deactivate' : 'Activate'}
                      </button>
                      <button
                        type="button"
                        className="hc-btn hc-btn-ghost"
                        disabled={saving}
                        onClick={() =>
                          void runMutation(async () => {
                            const label = readRowField(row, config.sourceColumn);
                            if (!window.confirm(`Delete mapping for "${label}"?`)) return;
                            const { error } = await supabase
                              .from(config.table)
                              .delete()
                              .eq('id', row.id);
                            if (error) {
                              onMessage(error.message);
                              return;
                            }
                            await onRefresh();
                            onMessage('Mapping deleted');
                          })
                        }
                      >
                        Delete
                      </button>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="hc-add-row hc-add-row--mapping">
        <input
          placeholder={config.sourcePlaceholder}
          value={newSource}
          onChange={(e) => setNewSource(e.target.value)}
          disabled={saving}
          aria-label={`New ${config.sourceLabel}`}
        />
        <input
          placeholder={config.targetPlaceholder}
          value={newTarget}
          onChange={(e) => setNewTarget(e.target.value)}
          disabled={saving}
          aria-label={`New ${config.targetLabel}`}
        />
        <label className="hc-checkbox-label">
          <input
            type="checkbox"
            checked={newActive}
            onChange={(e) => setNewActive(e.target.checked)}
            disabled={saving}
          />
          Active
        </label>
        <button
          type="button"
          className="hc-btn hc-btn-primary"
          disabled={saving}
          onClick={() =>
            void runMutation(async () => {
              const source = newSource.trim();
              const target = newTarget.trim();
              if (!source || !target) {
                onMessage('Source and target are required.');
                return;
              }
              const { error } = await supabase.from(config.table).insert({
                [config.sourceColumn]: source,
                [config.targetColumn]: target,
                active: newActive,
              });
              if (error) {
                onMessage(error.message);
                return;
              }
              setNewSource('');
              setNewTarget('');
              setNewActive(true);
              await onRefresh();
              onMessage('Mapping added');
            })
          }
        >
          Add
        </button>
      </div>
    </div>
  );
}

export const ICL_MAPPING_CRUD_CONFIG: MappingCrudConfig = {
  table: 'epic_icl_name_map',
  title: 'Epic case team → VHA SSDB ic_lead',
  sourceColumn: 'epic_icl_label',
  targetColumn: 'vha_icl_label',
  sourceLabel: 'Epic ICL label',
  targetLabel: 'VHA SSDB ic_lead',
  sourcePlaceholder: 'Epic ICL label (e.g. ZHANG CHUNG, DAN)',
  targetPlaceholder: 'VHA SSDB ic_lead (e.g. ZHANG CHUNG (UHN), MIGUEL A. (#18891))',
};

export const PATHWAY_MAPPING_CRUD_CONFIG: MappingCrudConfig = {
  table: 'epic_pathway_name_map',
  title: 'Epic episode → VHA SSDB pathway',
  sourceColumn: 'epic_episode_label',
  targetColumn: 'vha_pathway_code',
  sourceLabel: 'Epic episode label',
  targetLabel: 'VHA pathway code',
  sourcePlaceholder: 'Epic episode (e.g. UHN at Home - GIM)',
  targetPlaceholder: 'VHA pathway code (e.g. UHN-GIM)',
};
