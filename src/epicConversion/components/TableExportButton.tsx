import { DownloadDataIcon } from './DownloadDataIcon';

export function TableExportButton({
  disabled,
  ariaLabel,
  onClick,
}: {
  disabled?: boolean;
  ariaLabel: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="hc-btn hc-btn-secondary hc-btn-sm hc-btn-icon hc-btn-icon-download"
      disabled={disabled}
      aria-label={ariaLabel}
      title="Export table to Excel"
      onClick={onClick}
    >
      <DownloadDataIcon />
    </button>
  );
}
