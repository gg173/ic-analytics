import { useEffect, useId, useState, type ChangeEvent } from 'react';
import { validateConsolidatedImportFile } from '../ingest/validateConsolidatedImportFile';
import type { ImportUploadDialogPhase } from './EnrolmentUploadDialog';

export const IMPORT_DOCUMENT_TYPE_LABELS = {
  enrolment: 'VHA SSDB Enrolment Data',
  serviceData: 'VHA SSDB Service Data',
  carePlan: 'VHA EMRI Care Plan Templates',
  emar: 'VHA EMRI eMAR',
  epicReport: 'Epic Conversion Report',
} as const;

export type ConsolidatedImportKind = keyof typeof IMPORT_DOCUMENT_TYPE_LABELS;

export type ConsolidatedImportFiles = Record<ConsolidatedImportKind, File | null>;

const IMPORT_KINDS: ConsolidatedImportKind[] = [
  'enrolment',
  'serviceData',
  'carePlan',
  'emar',
  'epicReport',
];

function CheckIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="48"
      height="48"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" aria-hidden>
      <path d="M0 0h256v256H0z" fill="none" />
      <path
        fill="currentColor"
        d="M128 24a104 104 0 1 0 104 104A104.11 104.11 0 0 0 128 24m0 192a88 88 0 1 1 88-88a88.1 88.1 0 0 1-88 88m16-40a8 8 0 0 1-8 8a16 16 0 0 1-16-16v-40a8 8 0 0 1 0-16a16 16 0 0 1 16 16v40a8 8 0 0 1 8 8m-32-92a12 12 0 1 1 12 12a12 12 0 0 1-12-12"
      />
    </svg>
  );
}

interface ConsolidatedImportFileRowProps {
  kind: ConsolidatedImportKind;
  inputId: string;
  file: File | null;
  onFileChange: (kind: ConsolidatedImportKind, file: File | null) => void;
  onShowEnrolmentHowto: () => void;
}

function ConsolidatedImportFileRow({
  kind,
  inputId,
  file,
  onFileChange,
  onShowEnrolmentHowto,
}: ConsolidatedImportFileRowProps) {
  const [rowError, setRowError] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);

  useEffect(() => {
    if (!file) setRowError(null);
  }, [file]);

  const handleFileInputChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.target.files?.[0] ?? null;
    event.target.value = '';

    if (!nextFile) {
      setRowError(null);
      onFileChange(kind, null);
      return;
    }

    setValidating(true);
    setRowError(null);

    const result = await validateConsolidatedImportFile(nextFile, kind);
    setValidating(false);

    if (!result.ok) {
      setRowError(result.error);
      return;
    }

    onFileChange(kind, nextFile);
  };

  return (
    <div className="hc-consolidated-import-row">
      <div className="hc-consolidated-import-row-label">
        <button
          type="button"
          className="hc-btn hc-btn-ghost hc-import-column-info-btn hc-consolidated-import-info-btn"
          aria-label={
            kind === 'enrolment'
              ? 'How to export VHA SSDB enrolment data'
              : `About ${IMPORT_DOCUMENT_TYPE_LABELS[kind]}`
          }
          disabled={kind !== 'enrolment'}
          onClick={kind === 'enrolment' ? onShowEnrolmentHowto : undefined}
        >
          <InfoIcon />
        </button>
        <span className="hc-consolidated-import-row-title">
          {IMPORT_DOCUMENT_TYPE_LABELS[kind]}
        </span>
      </div>
      <label className="hc-enrolment-upload-file hc-consolidated-import-file" htmlFor={inputId}>
        <input
          id={inputId}
          type="file"
          accept=".xlsx,.xls"
          className="hc-enrolment-upload-file-input"
          disabled={validating}
          onChange={handleFileInputChange}
        />
        <span className="hc-enrolment-upload-file-label">
          {validating ? 'Checking file…' : (file?.name ?? 'Choose file…')}
        </span>
      </label>
      {rowError && (
        <p
          className="hc-form-error hc-consolidated-import-row-error"
          role="alert"
          aria-live="polite"
        >
          {rowError}
        </p>
      )}
    </div>
  );
}

interface ConsolidatedImportUploadDialogProps {
  open: boolean;
  phase: ImportUploadDialogPhase;
  files: ConsolidatedImportFiles;
  error: string | null;
  successMessage: string | null;
  onClose: () => void;
  onFileChange: (kind: ConsolidatedImportKind, file: File | null) => void;
  onSubmit: () => void;
  onShowEnrolmentHowto: () => void;
}

export function ConsolidatedImportUploadDialog({
  open,
  phase,
  files,
  error,
  successMessage,
  onClose,
  onFileChange,
  onSubmit,
  onShowEnrolmentHowto,
}: ConsolidatedImportUploadDialogProps) {
  const titleId = useId();
  const enrolmentInputId = useId();
  const serviceDataInputId = useId();
  const carePlanInputId = useId();
  const emarInputId = useId();
  const epicReportInputId = useId();
  const inputIds: Record<ConsolidatedImportKind, string> = {
    enrolment: enrolmentInputId,
    serviceData: serviceDataInputId,
    carePlan: carePlanInputId,
    emar: emarInputId,
    epicReport: epicReportInputId,
  };

  const hasAnyFile = IMPORT_KINDS.some((kind) => files[kind] !== null);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (phase === 'processing') return;
      onClose();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, phase, onClose]);

  if (!open) return null;

  const canDismiss = phase !== 'processing';

  const handleBackdropClick = () => {
    if (canDismiss) onClose();
  };

  return (
    <div
      className="hc-modal-backdrop"
      role="presentation"
      onClick={handleBackdropClick}
    >
      <div
        className="hc-modal hc-modal--consolidated-import"
        role="dialog"
        aria-modal="true"
        aria-labelledby={phase === 'form' ? titleId : undefined}
        aria-label={phase !== 'form' ? 'Import data' : undefined}
        aria-busy={phase === 'processing'}
        onClick={(e) => e.stopPropagation()}
      >
        {phase === 'form' && (
          <>
            <div className="hc-consolidated-import-header">
              <h2 id={titleId} className="hc-enrolment-upload-actions-title">
                Import Data
              </h2>
              {canDismiss && (
                <button
                  type="button"
                  className="hc-btn hc-btn-ghost hc-enrolment-upload-close"
                  aria-label="Close"
                  onClick={onClose}
                >
                  ×
                </button>
              )}
            </div>
            <div className="hc-consolidated-import-rows">
              {IMPORT_KINDS.map((kind) => (
                <ConsolidatedImportFileRow
                  key={kind}
                  kind={kind}
                  inputId={inputIds[kind]}
                  file={files[kind]}
                  onFileChange={onFileChange}
                  onShowEnrolmentHowto={onShowEnrolmentHowto}
                />
              ))}
              <button
                type="button"
                className="hc-btn hc-btn-primary"
                disabled={!hasAnyFile}
                onClick={onSubmit}
              >
                Import
              </button>
              {error && <p className="hc-form-error">{error}</p>}
            </div>
          </>
        )}

        {phase === 'processing' && (
          <div className="hc-enrolment-upload-status" role="status" aria-live="polite">
            <div className="hc-enrolment-upload-spinner" aria-hidden />
            <p className="hc-enrolment-upload-status-message">
              Please wait while your data is being processed…
            </p>
          </div>
        )}

        {phase === 'success' && (
          <div className="hc-enrolment-upload-status hc-enrolment-upload-status--success">
            <div className="hc-enrolment-upload-success-icon" aria-hidden>
              <CheckIcon />
            </div>
            <p className="hc-enrolment-upload-status-message">
              {successMessage ??
                'Your data has been processed and the data in this app has been refreshed.'}
            </p>
            <button type="button" className="hc-btn hc-btn-primary" onClick={onClose}>
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
