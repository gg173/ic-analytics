import { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import { parseHomecareCsvBuffer } from '../../homecare/ingest/parseHomecareCsv';
import { mapHomecareRows } from '../../homecare/ingest/mapHomecareRow';
import { parseSrvAllocationBuffer } from '../ingest/parseSrvAllocation';
import type { FlatFileImport } from '../types';
import type { Profile } from '../../homecare/types';

// ── Icons ─────────────────────────────────────────────────────────────────────

function UploadIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" strokeLinecap="round" strokeLinejoin="round" />
      <polyline points="17 8 12 3 7 8" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="12" y1="3" x2="12" y2="15" strokeLinecap="round" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" strokeLinecap="round" strokeLinejoin="round" />
      <polyline points="7 10 12 15 17 10" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="12" y1="15" x2="12" y2="3" strokeLinecap="round" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <polyline points="3 6 5 6 21 6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 11v6M14 11v6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── Date formatting (matches Epic Conversion pattern) ─────────────────────────

function formatImportDate(iso: string): { date: string; time: string } | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const weekday = d.toLocaleDateString('en-US', { weekday: 'short' });
  const month   = d.toLocaleDateString('en-US', { month: 'short' });
  const day     = d.getDate();
  const year    = d.getFullYear();
  const time    = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }).toLowerCase();
  return { date: `${weekday} ${month} ${day}, ${year}`, time };
}

function ImportDateCell({ uploadedAt }: { uploadedAt: string }) {
  const parts = formatImportDate(uploadedAt);
  if (!parts) return <>{uploadedAt}</>;
  return (
    <div className="hc-import-uploaded-date">
      <span className="hc-import-uploaded-date-day">{parts.date}</span>
      <span className="hc-import-uploaded-date-time">{parts.time}</span>
    </div>
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────

type ImportKind = 'visit_flat_file' | 'service_allocation';
type SortKey = 'document_type' | 'uploaded_at' | 'uploaded_by' | 'filename' | 'rows_in_file';
type SortDir = 'asc' | 'desc';

interface ImportRow extends FlatFileImport {
  kind: ImportKind;
  uploader_email: string | null;
}

const DOCUMENT_TYPE_LABELS: Record<ImportKind, string> = {
  visit_flat_file:    'Visit Flat File',
  service_allocation: 'Service Allocation',
};

// ── Hook: load imports ────────────────────────────────────────────────────────

function useImports() {
  const [imports, setImports] = useState<ImportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);

    const { data, error: err } = await supabase
      .from('flat_file_imports')
      .select('*')
      .order('uploaded_at', { ascending: false });

    if (err) { setError(err.message); setLoading(false); return; }

    const imports = (data ?? []) as FlatFileImport[];

    // Fetch uploader emails from profiles (uploaded_by → profiles.user_id)
    const uploaderIds = [...new Set(imports.map((r) => r.uploaded_by).filter(Boolean))] as string[];
    const emailById = new Map<string, string>();
    if (uploaderIds.length) {
      const { data: profileRows } = await supabase
        .from('profiles')
        .select('user_id, email')
        .in('user_id', uploaderIds);
      for (const p of profileRows ?? []) {
        if (p.user_id && p.email) emailById.set(p.user_id as string, p.email as string);
      }
    }

    const rows = imports.map((r) => {
      const isAlloc = r.filename?.toLowerCase().match(/\.(xlsx|xls)$/) != null;
      return {
        ...r,
        kind: isAlloc ? 'service_allocation' : 'visit_flat_file',
        uploader_email: r.uploaded_by ? (emailById.get(r.uploaded_by) ?? null) : null,
      } as ImportRow;
    });

    setImports(rows);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);
  return { imports, loading, error, refresh: load };
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface FileImportTabProps {
  profile: Profile | null;
  canEdit: boolean;
  onImportComplete: (mostRecentDate: string | null) => void;
}

// ── Main component ────────────────────────────────────────────────────────────

export function FileImportTab({ profile, canEdit, onImportComplete }: FileImportTabProps) {
  const visitRef = useRef<HTMLInputElement>(null);
  const allocRef = useRef<HTMLInputElement>(null);

  const { imports, loading, error, refresh } = useImports();
  const [uploading, setUploading]   = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'uploaded_at', dir: 'desc' });

  const sortedImports = useMemo(() => {
    return [...imports].sort((a, b) => {
      let cmp = 0;
      switch (sort.key) {
        case 'document_type': cmp = a.kind.localeCompare(b.kind); break;
        case 'uploaded_at':   cmp = a.uploaded_at.localeCompare(b.uploaded_at); break;
        case 'uploaded_by':   cmp = (a.uploader_email ?? '').localeCompare(b.uploader_email ?? ''); break;
        case 'filename':      cmp = a.filename.localeCompare(b.filename); break;
        case 'rows_in_file':  cmp = (a.rows_in_file ?? 0) - (b.rows_in_file ?? 0); break;
      }
      return sort.dir === 'asc' ? cmp : -cmp;
    });
  }, [imports, sort]);

  const toggleSort = (key: SortKey) => {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: 'asc' }
    );
  };

  const sortIndicator = (key: SortKey) =>
    sort.key === key ? (sort.dir === 'asc' ? ' hc-table-sort--asc' : ' hc-table-sort--desc') : '';

  // ── Upload: visit flat file ─────────────────────────────────────────────────

  const handleVisitFile = async (file: File) => {
    if (!profile?.user_id || !canEdit) return;
    setUploading(true);
    setUploadError(null);
    setUploadSuccess(null);

    try {
      const buf    = await file.arrayBuffer();
      const parsed = parseHomecareCsvBuffer(buf);
      if (parsed.errors.length) { setUploadError(parsed.errors.slice(0, 3).join('; ')); setUploading(false); return; }
      if (!parsed.rows.length)  { setUploadError('No data rows found.'); setUploading(false); return; }

      const mapped = mapHomecareRows(parsed.rows);
      const dates  = mapped.map((r) => r.service_date).filter((d): d is string => !!d).sort();
      const mostRecentDate = dates[dates.length - 1] ?? null;

      const storagePath = `billing-imports/${Date.now()}_${file.name}`;
      await supabase.storage.from('homecare-imports').upload(storagePath, file);

      const { data: importRec, error: impErr } = await supabase
        .from('flat_file_imports')
        .insert({
          pay_period_id: null,
          filename:      file.name,
          file_date:     mostRecentDate ?? new Date().toISOString().slice(0, 10),
          uploaded_by:   profile.user_id,
          rows_in_file:  mapped.length,
          storage_path:  storagePath,
        })
        .select()
        .single();

      if (impErr || !importRec) { setUploadError(impErr?.message ?? 'Failed to record import'); setUploading(false); return; }

      const { data: upsertResult, error: upsertErr } = await supabase.rpc('upsert_pay_period_visits', {
        p_import_id: importRec.id,
        p_visits:    mapped,
      });
      if (upsertErr) { setUploadError(upsertErr.message); setUploading(false); return; }

      await supabase.rpc('classify_visits_for_import', { p_import_id: importRec.id });

      const r = upsertResult as { inserted: number; updated: number; skipped: number };
      setUploadSuccess(`${file.name} — ${r.inserted} new, ${r.updated} updated, ${r.skipped} skipped`);
      await refresh();
      onImportComplete(mostRecentDate);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
    }
    setUploading(false);
  };

  // ── Upload: service allocation ──────────────────────────────────────────────

  const handleAllocFile = async (file: File) => {
    if (!profile?.user_id || !canEdit) return;
    setUploading(true);
    setUploadError(null);
    setUploadSuccess(null);

    try {
      const buf    = await file.arrayBuffer();
      const parsed = parseSrvAllocationBuffer(buf);
      if (parsed.errors.length) { setUploadError(parsed.errors.join('; ')); setUploading(false); return; }
      if (!parsed.rows.length)  { setUploadError('No valid rows found.'); setUploading(false); return; }

      const storagePath = `billing-imports/${Date.now()}_${file.name}`;
      await supabase.storage.from('homecare-imports').upload(storagePath, file);

      const { data: importRec, error: impErr } = await supabase
        .from('flat_file_imports')
        .insert({
          pay_period_id: null,
          filename:      file.name,
          file_date:     new Date().toISOString().slice(0, 10),
          uploaded_by:   profile.user_id,
          rows_in_file:  parsed.rows.length,
          storage_path:  storagePath,
        })
        .select()
        .single();

      if (impErr || !importRec) { setUploadError(impErr?.message ?? 'Failed to record import'); setUploading(false); return; }

      const { data: allocResult, error: allocErr } = await supabase.rpc('ingest_service_allocation', {
        p_rows: parsed.rows,
      });
      if (allocErr) { setUploadError(allocErr.message); setUploading(false); return; }

      const updated = (allocResult as { updated: number })?.updated ?? 0;
      setUploadSuccess(`${file.name} — care stream updated on ${updated} visit${updated !== 1 ? 's' : ''}`);
      await refresh();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
    }
    setUploading(false);
  };

  // ── Delete ──────────────────────────────────────────────────────────────────

  const handleDelete = async (imp: ImportRow) => {
    if (!canEdit) return;
    const confirmed = window.confirm(
      `Delete "${imp.filename}"?\n\nThis removes the import log entry. Visit records already ingested will remain in the system.`
    );
    if (!confirmed) return;
    setDeletingId(imp.id);
    await supabase.from('flat_file_imports').delete().eq('id', imp.id);
    if (imp.storage_path) {
      await supabase.storage.from('homecare-imports').remove([imp.storage_path]);
    }
    await refresh();
    setDeletingId(null);
  };

  // ── Download ────────────────────────────────────────────────────────────────

  const handleDownload = async (imp: ImportRow) => {
    if (!imp.storage_path) return;
    const { data } = await supabase.storage.from('homecare-imports').createSignedUrl(imp.storage_path, 60);
    if (data?.signedUrl) window.open(data.signedUrl, '_blank');
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  const SortHeader = ({ label, sortKey, className }: { label: string; sortKey: SortKey; className: string }) => (
    <th className={className}>
      <button
        type="button"
        className={`hc-table-sort${sortIndicator(sortKey)}`}
        onClick={() => toggleSort(sortKey)}
        aria-sort={sort.key === sortKey ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      >
        {label}
        <span className="hc-table-sort-indicator" aria-hidden />
      </button>
    </th>
  );

  return (
    <div className="hc-import-panels">

      {/* ── Header with upload button ──────────────────────── */}
      <div className="hc-import-panel-header">
        {canEdit && (
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <input ref={visitRef} type="file" accept=".csv" hidden
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleVisitFile(f); e.target.value = ''; }} />
            <input ref={allocRef} type="file" accept=".xlsx,.xls" hidden
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleAllocFile(f); e.target.value = ''; }} />

            <button
              type="button"
              className="hc-btn hc-btn-primary hc-import-upload-btn"
              disabled={uploading}
              onClick={() => visitRef.current?.click()}
              aria-label={uploading ? 'Uploading' : 'Upload visit flat file'}
            >
              <span className="hc-import-upload-btn-label">
                {uploading ? 'Uploading…' : 'Visit Flat File'}
              </span>
              <UploadIcon />
            </button>

            <button
              type="button"
              className="hc-btn hc-btn-secondary hc-import-upload-btn"
              disabled={uploading}
              onClick={() => allocRef.current?.click()}
              aria-label="Upload service allocation"
            >
              <span className="hc-import-upload-btn-label">Service Allocation</span>
              <UploadIcon />
            </button>
          </div>
        )}
      </div>

      {/* ── Import log table ───────────────────────────────── */}
      <section className="hc-panel hc-import-panel hc-import-panel--consolidated">
        {uploadError   && <p className="hc-form-error">{uploadError}</p>}
        {uploadSuccess && <p className="hc-info">{uploadSuccess}</p>}
        {error         && <p className="hc-form-error">{error}</p>}

        <div className="hc-import-column-body">
          <div className="hc-import-table-block">
            <div className="hc-table-wrap hc-import-table-wrap">
              <table className="hc-table hc-table--grid hc-table--import">
                <thead>
                  <tr>
                    <SortHeader label="Document Type" sortKey="document_type" className="hc-col-import-type" />
                    <SortHeader label="Uploaded Date"  sortKey="uploaded_at"   className="hc-col-import-date" />
                    <SortHeader label="Uploaded By"    sortKey="uploaded_by"   className="hc-col-import-by" />
                    <th className="hc-col-import-filename">File Name</th>
                    <SortHeader label="# Rows"         sortKey="rows_in_file"  className="hc-col-import-rows" />
                    <th className="hc-col-import-actions">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={6} className="hc-import-empty-cell">
                        <span className="hc-muted">Loading…</span>
                      </td>
                    </tr>
                  ) : sortedImports.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="hc-import-empty-cell">
                        <span className="hc-muted">No files imported yet.</span>
                      </td>
                    </tr>
                  ) : (
                    sortedImports.map((imp) => (
                      <tr key={imp.id}>
                        <td className="hc-col-import-type">
                          {DOCUMENT_TYPE_LABELS[imp.kind]}
                        </td>
                        <td className="hc-col-import-date">
                          <ImportDateCell uploadedAt={imp.uploaded_at} />
                        </td>
                        <td className="hc-col-import-by">
                          {imp.uploader_email
                            ? imp.uploader_email.split('@')[0]
                            : '—'}
                        </td>
                        <td className="hc-col-import-filename">
                          <span className="hc-import-filename" title={imp.filename}>
                            {imp.filename}
                          </span>
                        </td>
                        <td className="hc-col-import-rows">{imp.rows_in_file ?? '—'}</td>
                        <td className="hc-col-import-actions">
                          <div className="hc-table-actions">
                            <button
                              type="button"
                              className="hc-btn hc-btn-secondary hc-btn-sm hc-btn-icon hc-btn-icon-download"
                              aria-label={`Download ${imp.filename}`}
                              disabled={!imp.storage_path}
                              onClick={() => void handleDownload(imp)}
                            >
                              <DownloadIcon />
                            </button>
                            {canEdit && (
                              <button
                                type="button"
                                className="hc-btn hc-btn-danger hc-btn-sm hc-btn-icon"
                                aria-label={`Delete ${imp.filename}`}
                                disabled={deletingId === imp.id}
                                onClick={() => void handleDelete(imp)}
                              >
                                <TrashIcon />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      {/* File type guidance below the table */}
      <div className="hc-billing-import-guidance">
        <div className="hc-billing-import-guidance-item">
          <strong>Visit Flat File (CSV)</strong>
          <span className="hc-muted">Daily Epic export of all visit records for the last 7 days. The system matches each row to its pay week by service date and upserts automatically.</span>
        </div>
        <div className="hc-billing-import-guidance-item">
          <strong>Service Allocation (XLSX)</strong>
          <span className="hc-muted">The Epic Care Stream / Service Allocation report. Provides patient-level care stream assignments used to check visit limits. Upload after the flat file — matched to visits by MRN.</span>
        </div>
      </div>
    </div>
  );
}
