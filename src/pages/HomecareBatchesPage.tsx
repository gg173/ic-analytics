import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { parseHomecareCsvBuffer } from '../homecare/ingest/parseHomecareCsv';
import { mapHomecareRows } from '../homecare/ingest/mapHomecareRow';
import { useAuth } from '../homecare/hooks/useAuth';
import { deleteImportBatch, uploaderLabel, useBatches } from '../homecare/hooks/useBatch';
import type { ImportBatch } from '../homecare/types';
import { importBatchWithVisits } from '../homecare/hooks/useRules';
import { supabase } from '../lib/supabase';

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  validated: 'Validated',
  in_review: 'In review',
  ready_for_spo: 'Ready for SPO',
  pushed: 'Pushed',
};

export function HomecareBatchesPage() {
  const { user, canEdit, isSpo } = useAuth();
  const { batches, loading, error, refresh } = useBatches();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

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

      const { batchId, error: importError } = await importBatchWithVisits(
        file.name,
        mapped,
        user.id,
        storagePath
      );

      if (importError) {
        setUploadError(importError);
      } else if (batchId) {
        await refresh();
        window.location.href = `/homecare/batches/${batchId}`;
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
    }

    setUploading(false);
  };

  return (
    <div className="hc-page">
      <div className="hc-page-header">
        <div>
          <h1>Import batches</h1>
          <p className="hc-muted">
            {isSpo
              ? 'Review billing-ready batches released by UHN.'
              : 'Upload raw service CSVs, validate, and prep for SPO billing/payroll.'}
          </p>
        </div>
        {canEdit && (
          <div>
            <input
              ref={fileRef}
              type="file"
              accept=".csv"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleUpload(f);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              className="hc-btn hc-btn-primary"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
            >
              {uploading ? 'Uploading…' : 'Upload CSV'}
            </button>
          </div>
        )}
      </div>

      {uploadError && <p className="hc-form-error">{uploadError}</p>}
      {deleteError && <p className="hc-form-error">{deleteError}</p>}
      {error && <p className="hc-form-error">{error}</p>}

      {loading ? (
        <p className="hc-muted">Loading batches…</p>
      ) : batches.length === 0 ? (
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
                <th />
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
                  <td>
                    <div className="hc-table-actions">
                      <Link to={`/homecare/batches/${b.id}`} className="hc-btn hc-btn-success">
                        Open
                      </Link>
                      {canEdit && (
                        <button
                          type="button"
                          className="hc-btn hc-btn-danger"
                          disabled={deletingId === b.id}
                          onClick={() => handleDelete(b)}
                        >
                          {deletingId === b.id ? 'Deleting…' : 'Delete'}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
