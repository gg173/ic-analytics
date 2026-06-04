import { useEffect } from 'react';
import {
  SSDB_ENROLMENT_HOWTO_IMAGE_ALT,
  SSDB_ENROLMENT_HOWTO_IMAGE_SRC,
} from '../constants/ssdbEnrolmentHowto';

interface SsdbEnrolmentHowtoModalProps {
  open: boolean;
  onClose: () => void;
}

export function SsdbEnrolmentHowtoModal({ open, onClose }: SsdbEnrolmentHowtoModalProps) {
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="hc-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="hc-modal hc-modal--ssdb-howto"
        role="dialog"
        aria-modal="true"
        aria-label="How to export VHA SSDB enrolment data"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="hc-modal-header hc-modal-header--ssdb-howto">
          <button
            type="button"
            className="hc-btn hc-btn-ghost hc-modal-close"
            aria-label="Close"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <div className="hc-enrolment-upload-howto">
          <img
            src={SSDB_ENROLMENT_HOWTO_IMAGE_SRC}
            alt={SSDB_ENROLMENT_HOWTO_IMAGE_ALT}
            className="hc-enrolment-upload-howto-img"
          />
        </div>
      </div>
    </div>
  );
}
