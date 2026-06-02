import { useEffect, useId, type ChangeEvent } from 'react';

const SSDB_HOWTO_IMAGE_SRC = '/epic/ssdb-enrolment-export-howto.png';

export type EnrolmentUploadDialogPhase = 'form' | 'processing' | 'success';

interface EnrolmentUploadDialogProps {
  open: boolean;
  phase: EnrolmentUploadDialogPhase;
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

export function EnrolmentUploadDialog({
  open,
  phase,
  selectedFile,
  error,
  successMessage,
  onClose,
  onFileChange,
  onSubmit,
}: EnrolmentUploadDialogProps) {
  const fileInputId = useId();

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
        aria-labelledby={phase === 'form' ? 'enrolment-upload-dialog-title' : undefined}
        aria-label={phase !== 'form' ? 'Upload VHA SSDB Enrolment Data' : undefined}
        aria-busy={phase === 'processing'}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="hc-modal-header hc-modal-header--enrolment-upload">
          {canDismiss && (
            <button
              type="button"
              className="hc-btn hc-btn-ghost hc-modal-close"
              aria-label="Close"
              onClick={onClose}
            >
              ×
            </button>
          )}
        </header>

        {phase === 'form' && (
          <>
            <div className="hc-enrolment-upload-form-body">
              <div className="hc-enrolment-upload-howto">
                <img
                  src={SSDB_HOWTO_IMAGE_SRC}
                  alt="SSDB export instructions: navigate to SSDB Enrollment Data, clear filters, select ACTIVE enrollment status, then export data from the table menu"
                  className="hc-enrolment-upload-howto-img"
                />
              </div>
              <div className="hc-enrolment-upload-actions">
                <h2 id="enrolment-upload-dialog-title" className="hc-enrolment-upload-actions-title">
                  Upload VHA SSDB Enrolment Data
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
              </div>
            </div>
            {error && <p className="hc-form-error">{error}</p>}
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
