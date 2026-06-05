import { useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { parseHomecareCsvBuffer } from '../../homecare/ingest/parseHomecareCsv';
import { mapHomecareRows } from '../../homecare/ingest/mapHomecareRow';
import { parseSrvAllocationBuffer } from '../ingest/parseSrvAllocation';
import type { Profile } from '../../homecare/types';

interface BillingUploadPanelProps {
  profile: Profile | null;
  canEdit: boolean;
  onUploadComplete: (mostRecentDate: string | null) => void;
}

type UploadPhase = 'idle' | 'parsing' | 'uploading' | 'classifying' | 'done';

interface UploadResult {
  filename: string;
  inserted: number;
  updated: number;
  skipped: number;
  weeksAffected: number;
}

export function BillingUploadPanel({ profile, canEdit, onUploadComplete }: BillingUploadPanelProps) {
  const visitFileRef = useRef<HTMLInputElement>(null);
  const allocFileRef = useRef<HTMLInputElement>(null);

  const [visitPhase, setVisitPhase]   = useState<UploadPhase>('idle');
  const [allocPhase, setAllocPhase]   = useState<UploadPhase>('idle');
  const [visitError, setVisitError]   = useState<string | null>(null);
  const [allocError, setAllocError]   = useState<string | null>(null);
  const [visitResult, setVisitResult] = useState<UploadResult | null>(null);
  const [allocResult, setAllocResult] = useState<{ filename: string; updated: number } | null>(null);

  // ── Visit flat file ─────────────────────────────────────────────────────────

  const handleVisitFile = async (file: File) => {
    if (!profile?.user_id || !canEdit) return;
    setVisitError(null);
    setVisitResult(null);
    setVisitPhase('parsing');

    try {
      const buf = await file.arrayBuffer();
      const parsed = parseHomecareCsvBuffer(buf);

      if (parsed.errors.length) {
        setVisitError(parsed.errors.slice(0, 3).join('; '));
        setVisitPhase('idle');
        return;
      }
      if (parsed.rows.length === 0) {
        setVisitError('No data rows found in the file.');
        setVisitPhase('idle');
        return;
      }

      const mapped = mapHomecareRows(parsed.rows);

      // Find the most recent service date in the file (for calendar navigation)
      const dates = mapped
        .map((r) => r.service_date)
        .filter((d): d is string => !!d)
        .sort();
      const mostRecentDate = dates[dates.length - 1] ?? null;

      setVisitPhase('uploading');

      // Store the file in storage
      const storagePath = `billing-imports/${Date.now()}_${file.name}`;
      await supabase.storage.from('homecare-imports').upload(storagePath, file);

      // Create a flat_file_import record (not tied to any specific pay period)
      const { data: importRecord, error: importErr } = await supabase
        .from('flat_file_imports')
        .insert({
          pay_period_id: null,
          filename: file.name,
          file_date: mostRecentDate ?? new Date().toISOString().slice(0, 10),
          uploaded_by: profile.user_id,
          rows_in_file: mapped.length,
          storage_path: storagePath,
        })
        .select()
        .single();

      if (importErr || !importRecord) {
        setVisitError(importErr?.message ?? 'Failed to record import');
        setVisitPhase('idle');
        return;
      }

      // Upsert visits — RPC auto-creates pay periods and routes by service date
      const { data: upsertResult, error: upsertErr } = await supabase.rpc(
        'upsert_pay_period_visits',
        { p_import_id: importRecord.id, p_visits: mapped }
      );

      if (upsertErr) {
        setVisitError(upsertErr.message);
        setVisitPhase('idle');
        return;
      }

      setVisitPhase('classifying');

      // Run classification for all affected pay periods
      await supabase.rpc('classify_visits_for_import', { p_import_id: importRecord.id });

      // Count distinct pay periods affected
      const { data: periodRows } = await supabase
        .from('service_visits')
        .select('pay_period_id')
        .eq('last_import_id', importRecord.id);

      const weeksAffected = new Set((periodRows ?? []).map((r: { pay_period_id: string }) => r.pay_period_id)).size;

      setVisitResult({
        filename: file.name,
        inserted: (upsertResult as { inserted: number })?.inserted ?? 0,
        updated:  (upsertResult as { updated: number })?.updated  ?? 0,
        skipped:  (upsertResult as { skipped: number })?.skipped  ?? 0,
        weeksAffected,
      });

      setVisitPhase('done');
      onUploadComplete(mostRecentDate);
    } catch (err) {
      setVisitError(err instanceof Error ? err.message : 'Upload failed');
      setVisitPhase('idle');
    }
  };

  // ── Service allocation file ─────────────────────────────────────────────────

  const handleAllocFile = async (file: File) => {
    if (!profile?.user_id || !canEdit) return;
    setAllocError(null);
    setAllocResult(null);
    setAllocPhase('parsing');

    try {
      const buf = await file.arrayBuffer();
      const parsed = parseSrvAllocationBuffer(buf);

      if (parsed.errors.length) {
        setAllocError(parsed.errors.join('; '));
        setAllocPhase('idle');
        return;
      }
      if (parsed.rows.length === 0) {
        setAllocError('No valid rows found. Check that this is the Service Allocation report.');
        setAllocPhase('idle');
        return;
      }

      setAllocPhase('uploading');

      const { data, error } = await supabase.rpc('ingest_service_allocation', {
        p_rows: parsed.rows,
      });

      if (error) {
        setAllocError(error.message);
        setAllocPhase('idle');
        return;
      }

      setAllocResult({
        filename: file.name,
        updated: (data as { updated: number })?.updated ?? 0,
      });
      setAllocPhase('done');
    } catch (err) {
      setAllocError(err instanceof Error ? err.message : 'Upload failed');
      setAllocPhase('idle');
    }
  };

  const visitBusy  = visitPhase !== 'idle' && visitPhase !== 'done';
  const allocBusy  = allocPhase !== 'idle' && allocPhase !== 'done';

  const visitBtnLabel =
    visitPhase === 'parsing'    ? 'Reading file…'     :
    visitPhase === 'uploading'  ? 'Uploading…'         :
    visitPhase === 'classifying'? 'Classifying visits…':
    visitPhase === 'done'       ? 'Upload another'     :
    'Upload visit flat file';

  const allocBtnLabel =
    allocPhase === 'parsing'   ? 'Reading file…' :
    allocPhase === 'uploading' ? 'Merging data…' :
    allocPhase === 'done'      ? 'Upload another' :
    'Upload service allocation';

  if (!canEdit) return null;

  return (
    <div className="hc-billing-upload-panel">
      <div className="hc-billing-upload-panel-header">
        <h2 className="hc-billing-section-title" style={{ margin: 0 }}>File Uploads</h2>
        <p className="hc-muted" style={{ margin: 0, fontSize: '0.82rem' }}>
          Upload files here — the system routes visit data to the correct pay weeks automatically.
          No need to select a week before uploading.
        </p>
      </div>

      <div className="hc-billing-upload-slots">

        {/* ── Slot 1: Visit flat file ─────────────────────── */}
        <div className="hc-billing-upload-slot">
          <div className="hc-billing-upload-slot-label">
            <span className="hc-billing-upload-slot-number">1</span>
            <div>
              <strong>Visit flat file</strong>
              <span className="hc-billing-upload-slot-required">Required · CSV</span>
            </div>
          </div>
          <p className="hc-muted" style={{ fontSize: '0.8rem', margin: '0.4rem 0 0.75rem' }}>
            The daily Epic export containing all visit records for the last 7 days.
            Each row is matched to its pay week by service date. Previously uploaded visits
            are updated in place if the record has changed.
          </p>

          {visitResult && (
            <div className="hc-info hc-billing-upload-result">
              <strong>{visitResult.filename}</strong> — {visitResult.inserted} new,{' '}
              {visitResult.updated} updated, {visitResult.skipped} skipped
              {visitResult.weeksAffected > 0 && (
                <> · {visitResult.weeksAffected} week{visitResult.weeksAffected !== 1 ? 's' : ''} affected</>
              )}
            </div>
          )}
          {visitError && <p className="hc-form-error">{visitError}</p>}

          <input
            ref={visitFileRef}
            type="file"
            accept=".csv"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleVisitFile(f);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            className="hc-btn hc-btn-primary hc-btn-sm"
            disabled={visitBusy}
            onClick={() => visitFileRef.current?.click()}
          >
            {visitBtnLabel}
          </button>
        </div>

        {/* ── Slot 2: Service allocation ──────────────────── */}
        <div className="hc-billing-upload-slot hc-billing-upload-slot--optional">
          <div className="hc-billing-upload-slot-label">
            <span className="hc-billing-upload-slot-number hc-billing-upload-slot-number--optional">2</span>
            <div>
              <strong>Service allocation report</strong>
              <span className="hc-billing-upload-slot-optional">Optional · XLSX</span>
            </div>
          </div>
          <p className="hc-muted" style={{ fontSize: '0.8rem', margin: '0.4rem 0 0.75rem' }}>
            The Epic Care Stream / Service Allocation report. Provides patient-level care stream
            assignments (e.g. "Moderate Needs – Up to 10 visits") used to check visit limits.
            Upload after the visit flat file. Matched to visits by MRN.
          </p>

          {!visitResult && visitPhase === 'idle' && (
            <p className="hc-muted" style={{ fontSize: '0.78rem', fontStyle: 'italic' }}>
              Upload the visit flat file first before uploading this file.
            </p>
          )}

          {allocResult && (
            <div className="hc-info hc-billing-upload-result">
              <strong>{allocResult.filename}</strong> — care stream updated on {allocResult.updated} visit{allocResult.updated !== 1 ? 's' : ''}
            </div>
          )}
          {allocError && <p className="hc-form-error">{allocError}</p>}

          <input
            ref={allocFileRef}
            type="file"
            accept=".xlsx,.xls"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleAllocFile(f);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            className="hc-btn hc-btn-secondary hc-btn-sm"
            disabled={allocBusy || (visitPhase === 'idle' && !visitResult)}
            onClick={() => allocFileRef.current?.click()}
          >
            {allocBtnLabel}
          </button>
        </div>

      </div>
    </div>
  );
}
