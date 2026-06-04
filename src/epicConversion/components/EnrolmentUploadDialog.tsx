import { useEffect, useId, type ChangeEvent } from 'react';

export type ImportUploadDialogPhase = 'form' | 'processing' | 'success';

/** @deprecated Use ImportUploadDialogPhase */
export type EnrolmentUploadDialogPhase = ImportUploadDialogPhase;

interface ImportUploadDialogProps {
  open: boolean;
  phase: ImportUploadDialogPhase;
  title: string;
  selectedFile: File | null;
  error: string | null;
  successMessage: string | null;
  onClose: () => void;
  onFileChange: (file: File | null) => void;
  onSubmit: () => void;
}

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

export function ImportUploadDialog({
  open,
  phase,
  title,
  selectedFile,
  error,
  successMessage,
  onClose,
  onFileChange,
  onSubmit,
}: ImportUploadDialogProps) {
  const fileInputId = useId();
  const titleId = useId();

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

  const handleFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    onFileChange(file);
    event.target.value = '';
  };

  return (
    <div
      className="hc-modal-backdrop"
      role="presentation"
      onClick={handleBackdropClick}
    >
      <div
        className="hc-modal hc-modal--enrolment-upload"
        role="dialog"
        aria-modal="true"
        aria-labelledby={phase === 'form' ? titleId : undefined}
        aria-label={phase !== 'form' ? title : undefined}
        aria-busy={phase === 'processing'}
        onClick={(e) => e.stopPropagation()}
      >
        {phase === 'form' && (
          <div className="hc-enrolment-upload-actions">
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
            <h2 id={titleId} className="hc-enrolment-upload-actions-title">
              {title}
            </h2>
            <label className="hc-enrolment-upload-file" htmlFor={fileInputId}>
              <input
                id={fileInputId}
                type="file"
                accept=".xlsx,.xls"
                className="hc-enrolment-upload-file-input"
                onChange={handleFileInputChange}
              />
              <span className="hc-enrolment-upload-file-label">
                {selectedFile ? selectedFile.name : 'Choose file…'}
              </span>
            </label>
            <button
              type="button"
              className="hc-btn hc-btn-primary"
              disabled={!selectedFile}
              onClick={onSubmit}
            >
              Submit
            </button>
            {error && <p className="hc-form-error">{error}</p>}
          </div>
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

export function EnrolmentUploadDialog(
  props: Omit<ImportUploadDialogProps, 'title'>
) {
  return <ImportUploadDialog title="Upload VHA SSDB Enrolment Data" {...props} />;
}
