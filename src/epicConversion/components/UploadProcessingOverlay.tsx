import { useEffect } from 'react';

export type UploadProcessingOverlayPhase = 'processing' | 'success';

interface UploadProcessingOverlayProps {
  open: boolean;
  phase: UploadProcessingOverlayPhase;
  ariaLabel: string;
  processingMessage?: string;
  successMessage?: string;
  onClose: () => void;
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

export function UploadProcessingOverlay({
  open,
  phase,
  ariaLabel,
  processingMessage = 'Please wait while your data is being processed…',
  successMessage = 'Your data has been processed and the data in this app has been refreshed.',
  onClose,
}: UploadProcessingOverlayProps) {
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
        className="hc-modal hc-modal--upload-processing"
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        aria-busy={phase === 'processing'}
        onClick={(e) => e.stopPropagation()}
      >
        {phase === 'processing' && (
          <div className="hc-enrolment-upload-status" role="status" aria-live="polite">
            <div className="hc-enrolment-upload-spinner" aria-hidden />
            <p className="hc-enrolment-upload-status-message">{processingMessage}</p>
          </div>
        )}

        {phase === 'success' && (
          <div
            className="hc-enrolment-upload-status hc-enrolment-upload-status--success"
            role="status"
            aria-live="polite"
          >
            <div className="hc-enrolment-upload-success-icon" aria-hidden>
              <CheckIcon />
            </div>
            <p className="hc-enrolment-upload-status-message">{successMessage}</p>
            <button type="button" className="hc-btn hc-btn-primary" onClick={onClose}>
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
