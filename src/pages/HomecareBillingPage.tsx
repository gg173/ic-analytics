import { useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { parseHomecareCsvBuffer } from '../homecare/ingest/parseHomecareCsv';
import { mapHomecareRows } from '../homecare/ingest/mapHomecareRow';
import { useAuth } from '../homecare/hooks/useAuth';
import { deleteImportBatch, uploaderLabel, useBatches } from '../homecare/hooks/useBatch';
import { importBatchWithVisits } from '../homecare/hooks/useImportBatch';
import type { ImportBatch } from '../homecare/types';
import { supabase } from '../lib/supabase';

import { IMPORT_DATA_TAB, OVERVIEW_TAB } from '../homecare/billingTabs';

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  validated: 'Validated',
  in_review: 'In review',
  ready_for_spo: 'Ready for SPO',
  pushed: 'Pushed',
};

type HomecareBillingLocationState = {
  tab?: string;
};

function resolveInitialTab(state: HomecareBillingLocationState | null): string {
  const tab = state?.tab;
  if (tab === IMPORT_DATA_TAB) return IMPORT_DATA_TAB;
  return OVERVIEW_TAB;
}

export function HomecareBillingPage() {
  const location = useLocation();
  const { user, canEdit } = useAuth();
  const initialTab = resolveInitialTab(location.state as HomecareBillingLocationState | null);
  const { batches, loading, error, refresh } = useBatches();
  const fileRef = useRef<HTMLInputElement>(null);
  const [activeTab, setActiveTab] = useState(initialTab);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const isOverviewTab = activeTab === OVERVIEW_TAB;
  const isImportDataTab = activeTab === IMPORT_DATA_TAB;

  const handleDelete = async (batch: ImportBatch) => {
    if (!canEdit) return;
    const confirmed = window.confirm(
      `Delete "${batch.filename}" permanently?\n\nThis removes all visits, issues, audit history, and the uploaded CSV from Supabase. This cannot be undone.`
    );
    if (!confirmed) return;

    setDeletingId(batch.id);
    setDeleteError(null);
    const { error: err } = await deleteImportBatch(batch);
    if (err) {
      setDeleteError(err);
    } else {
      await refresh();
    }
    setDeletingId(null);
  };

  const handleUpload = async (file: File) => {
    if (!user || !canEdit) return;
    setUploading(true);
    setUploadError(null);

    try {
      const buf = await file.arrayBuffer();
      const parsed = parseHomecareCsvBuffer(buf);
      if (parsed.errors.length) {
        setUploadError(parsed.errors.slice(0, 3).join('; '));
        setUploading(false);
        return;
      }

      const mapped = mapHomecareRows(parsed.rows);
      const storagePath = `imports/${Date.now()}_${file.name}`;
      await supabase.storage.from('homecare-imports').upload(storagePath, file);

      const { error: importError } = await importBatchWithVisits(
        file.name,
        mapped,
        user.id,
        storagePath
      );

      if (importError) {
        setUploadError(importError);
      } else {
        setActiveTab(IMPORT_DATA_TAB);
        await refresh();
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
    }

    setUploading(false);
  };

  return (
    <>
      <div className="hc-page hc-page--split">
        <input
          ref={fileRef}
          type="file"
          accept=".csv"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleUpload(f);
            e.target.value = '';
          }}
        />

        {!loading && (
          <nav className="hc-strategy-tabs hc-strategy-tabs--below-title" aria-label="Homecare billing">
            <button
              type="button"
              className={`hc-strategy-tab${isOverviewTab ? ' hc-strategy-tab--active' : ''}`}
              onClick={() => setActiveTab(OVERVIEW_TAB)}
            >
              {OVERVIEW_TAB}
            </button>
            <button
              type="button"
              className={`hc-strategy-tab${isImportDataTab ? ' hc-strategy-tab--active' : ''}`}
              onClick={() => setActiveTab(IMPORT_DATA_TAB)}
            >
              {IMPORT_DATA_TAB}
            </button>
          </nav>
        )}

        {uploadError && !isImportDataTab && <p className="hc-form-error">{uploadError}</p>}
        {deleteError && !isImportDataTab && <p className="hc-form-error">{deleteError}</p>}
        {error && <p className="hc-form-error">{error}</p>}

        {loading && <p className="hc-muted">Loading batches…</p>}
      </div>

      {!loading && isOverviewTab && (
        <section className="hc-billing-overview" aria-label="Homecare billing overview">
          <div className="hc-panel hc-empty">
            <p className="hc-muted">Overview content will appear here.</p>
          </div>
        </section>
      )}

      {!loading && isImportDataTab && (
        <section className="hc-billing-import-data" aria-label="Import data">
          <div className="hc-page-header">
            <div>
              <h2 className="hc-panel-title">Import batches</h2>
              <p className="hc-muted">Upload service CSV files and manage import batches.</p>
            </div>
            {canEdit && (
              <button
                type="button"
                className="hc-btn hc-btn-primary"
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
              >
                {uploading ? 'Uploading…' : 'Upload CSV'}
              </button>
            )}
          </div>

          {uploadError && <p className="hc-form-error">{uploadError}</p>}
          {deleteError && <p className="hc-form-error">{deleteError}</p>}

          {batches.length === 0 ? (
            <div className="hc-panel hc-empty">
              <p>No batches yet.{canEdit && ' Upload a CSV to get started.'}</p>
            </div>
          ) : (
            <div className="hc-table-wrap">
              <table className="hc-table hc-table--grid">
                <thead>
                  <tr>
                    <th>Filename</th>
                    <th>Status</th>
                    <th>Rows</th>
                    <th>Issues</th>
                    <th>Uploaded</th>
                    {canEdit && <th />}
                  </tr>
                </thead>
                <tbody>
                  {batches.map((b) => (
                    <tr key={b.id}>
                      <td>{b.filename}</td>
                      <td>
                        <span className={`hc-badge hc-badge--${b.status}`}>
                          {STATUS_LABELS[b.status] ?? b.status}
                        </span>
                      </td>
                      <td>{b.row_count}</td>
                      <td>{b.issue_count}</td>
                      <td className="hc-uploaded-cell">
                        <span className="hc-uploaded-by">{uploaderLabel(b.uploader)}</span>
                        <span className="hc-uploaded-at">
                          {new Date(b.uploaded_at).toLocaleString()}
                        </span>
                      </td>
                      {canEdit && (
                        <td>
                          <button
                            type="button"
                            className="hc-btn hc-btn-danger"
                            disabled={deletingId === b.id}
                            onClick={() => void handleDelete(b)}
                          >
                            {deletingId === b.id ? 'Deleting…' : 'Delete'}
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </>
  );
}
