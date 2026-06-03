import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  useToolbarMultiselectDismiss,
  useToolbarMultiselectFloatingMenu,
} from './useToolbarMultiselectFloatingMenu';

type ToolbarMultiSelectProps = {
  options: readonly string[];
  selected: readonly string[] | null;
  onChange: (next: string[] | null) => void;
  selectAllLabel?: string;
  ariaLabel: string;
  /** Show selected labels while count is at or below this; above it, show "N Selected". */
  maxLabelsBeforeCount?: number;
  formatOptionLabel?: (value: string) => string;
};

/** Display-only cleanup for Epic-style labels (e.g. IC Lead). Raw values stay unchanged for filtering. */
export function formatToolbarOptionLabel(value: string): string {
  return value
    .replace(/\s*\(UHN\)\s*/gi, '')
    .replace(/\s*\(#\d+\)\s*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function isAllSelected(
  selected: readonly string[] | null,
  options: readonly string[]
): boolean {
  if (selected === null) return true;
  if (options.length === 0) return true;
  return options.every((value) => selected.includes(value));
}

export function matchesMultiFilter(
  selected: readonly string[] | null,
  value: string | null,
  options: readonly string[]
): boolean {
  if (isAllSelected(selected, options)) return true;
  if (!selected?.length) return false;
  if (!value) return false;
  return selected.includes(value);
}

export function ToolbarMultiSelect({
  options,
  selected,
  onChange,
  selectAllLabel = 'Select All',
  ariaLabel,
  maxLabelsBeforeCount = 3,
  formatOptionLabel = formatToolbarOptionLabel,
}: ToolbarMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);

  const allValues = useMemo(() => [...options], [options]);
  const effectiveSelected = selected ?? allValues;
  const allSelected = isAllSelected(selected, options);
  const someSelected = !allSelected && effectiveSelected.length > 0;

  useToolbarMultiselectDismiss(open, rootRef, menuRef, () => setOpen(false));
  useToolbarMultiselectFloatingMenu(open, rootRef, menuRef, [options.length]);

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someSelected;
    }
  }, [someSelected, open]);

  const summary = useMemo(() => {
    if (allSelected) return 'All';
    if (effectiveSelected.length === 0) return 'None';
    const selectedInOrder = options.filter((option) => effectiveSelected.includes(option));
    if (selectedInOrder.length <= maxLabelsBeforeCount) {
      return selectedInOrder.map(formatOptionLabel).join(', ');
    }
    return `${selectedInOrder.length} Selected`;
  }, [allSelected, effectiveSelected, formatOptionLabel, maxLabelsBeforeCount, options]);

  const toggleSelectAll = () => {
    onChange(allSelected ? [] : null);
  };

  const toggle = (value: string) => {
    const current = selected ?? allValues;
    const next = current.includes(value)
      ? current.filter((item) => item !== value)
      : [...current, value];

    if (next.length === 0) {
      onChange([]);
      return;
    }
    if (allValues.every((item) => next.includes(item))) {
      onChange(null);
      return;
    }
    onChange(next);
  };

  return (
    <div className="hc-toolbar-multiselect" ref={rootRef}>
      <button
        type="button"
        className="hc-toolbar-multiselect-trigger"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className="hc-toolbar-multiselect-trigger-label">{summary}</span>
        <span className="hc-toolbar-multiselect-chevron" aria-hidden="true">
          <svg viewBox="0 0 12 12" width="12" height="12" focusable="false">
            <path
              d="M3 4.5 6 7.5 9 4.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="hc-toolbar-multiselect-menu hc-toolbar-multiselect-menu--floating"
            role="listbox"
            aria-label={ariaLabel}
            aria-multiselectable
          >
            <label className="hc-toolbar-multiselect-option">
              <input
                ref={selectAllRef}
                type="checkbox"
                checked={allSelected}
                onChange={toggleSelectAll}
              />
              <span>{selectAllLabel}</span>
            </label>
            {options.map((option) => (
              <label key={option} className="hc-toolbar-multiselect-option">
                <input
                  type="checkbox"
                  checked={effectiveSelected.includes(option)}
                  onChange={() => toggle(option)}
                />
                <span>{formatOptionLabel(option)}</span>
              </label>
            ))}
          </div>,
          document.body
        )}
    </div>
  );
}
