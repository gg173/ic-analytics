import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  effectiveCarePathSelection,
  isPathwayCarePathFilterAllSelected,
  isPathwayGroupChecked,
  isPathwayGroupIndeterminate,
  PATHWAY_CARE_PATH_FILTER_ALL,
  PATHWAY_CARE_PATH_FILTER_NONE,
  toggleCarePathInSelection,
  togglePathwayGroupInSelection,
  type PathwayCarePathFilterGroup,
  type PathwayCarePathFilterSelection,
} from '../carePlan/pathwayCarePathFilter';
import { formatToolbarOptionLabel } from './ToolbarMultiSelect';
import {
  useToolbarMultiselectDismiss,
  useToolbarMultiselectFloatingMenu,
} from './useToolbarMultiselectFloatingMenu';

type ToolbarPathwayCarePathMultiSelectProps = {
  groups: readonly PathwayCarePathFilterGroup[];
  selection: PathwayCarePathFilterSelection;
  onChange: (next: PathwayCarePathFilterSelection) => void;
  ariaLabel: string;
  maxLabelsBeforeCount?: number;
};

export function ToolbarPathwayCarePathMultiSelect({
  groups,
  selection,
  onChange,
  ariaLabel,
  maxLabelsBeforeCount = 3,
}: ToolbarPathwayCarePathMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const pathwayCheckboxRefs = useRef<Map<string, HTMLInputElement>>(new Map());

  const effectiveCarePaths = useMemo(
    () => effectiveCarePathSelection(selection, groups),
    [selection, groups]
  );
  const allSelected = isPathwayCarePathFilterAllSelected(selection);
  const someSelected =
    !allSelected &&
    (effectiveCarePaths.length > 0 ||
      (selection.pathwaysOnly !== null && selection.pathwaysOnly.length > 0));

  useToolbarMultiselectDismiss(open, rootRef, menuRef, () => setOpen(false));
  useToolbarMultiselectFloatingMenu(open, rootRef, menuRef, [groups.length]);

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someSelected;
    }
  }, [someSelected, open]);

  useEffect(() => {
    if (!open) return;
    for (const group of groups) {
      const input = pathwayCheckboxRefs.current.get(group.pathway);
      if (input) {
        input.indeterminate = isPathwayGroupIndeterminate(group, selection, groups);
      }
    }
  }, [open, groups, selection]);

  const summary = useMemo(() => {
    if (allSelected) return 'All';
    if (
      selection.carePaths !== null &&
      selection.carePaths.length === 0 &&
      selection.pathwaysOnly !== null &&
      selection.pathwaysOnly.length === 0
    ) {
      return 'None';
    }

    const labels: string[] = [];
    for (const group of groups) {
      if (group.carePaths.length > 0) {
        const selectedInGroup = group.carePaths.filter((carePath) =>
          effectiveCarePaths.includes(carePath)
        );
        if (selectedInGroup.length === group.carePaths.length) {
          labels.push(formatToolbarOptionLabel(group.pathway));
        } else {
          labels.push(...selectedInGroup.map(formatToolbarOptionLabel));
        }
      } else if (isPathwayGroupChecked(group, selection, groups)) {
        labels.push(formatToolbarOptionLabel(group.pathway));
      }
    }

    if (labels.length <= maxLabelsBeforeCount) {
      return labels.join(', ');
    }
    return `${labels.length} Selected`;
  }, [allSelected, effectiveCarePaths, groups, maxLabelsBeforeCount, selection]);

  const toggleSelectAll = () => {
    onChange(allSelected ? PATHWAY_CARE_PATH_FILTER_NONE : PATHWAY_CARE_PATH_FILTER_ALL);
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
            className="hc-toolbar-multiselect-menu hc-toolbar-multiselect-menu--floating hc-toolbar-multiselect-menu--pathway-nested"
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
              <span>Select All</span>
            </label>
            {groups.map((group) => {
              const groupChecked = isPathwayGroupChecked(group, selection, groups);
              return (
                <div key={group.pathway} className="hc-toolbar-pathway-group">
                  <label className="hc-toolbar-multiselect-option hc-toolbar-multiselect-option--pathway">
                    <input
                      type="checkbox"
                      checked={groupChecked}
                      ref={(el) => {
                        if (el) {
                          pathwayCheckboxRefs.current.set(group.pathway, el);
                        } else {
                          pathwayCheckboxRefs.current.delete(group.pathway);
                        }
                      }}
                      onChange={() =>
                        onChange(togglePathwayGroupInSelection(selection, group, groups))
                      }
                    />
                    <span>{formatToolbarOptionLabel(group.pathway)}</span>
                  </label>
                  {group.carePaths.map((carePath) => (
                    <label
                      key={carePath}
                      className="hc-toolbar-multiselect-option hc-toolbar-multiselect-option--care-path"
                    >
                      <input
                        type="checkbox"
                        checked={effectiveCarePaths.includes(carePath)}
                        onChange={() =>
                          onChange(toggleCarePathInSelection(selection, carePath, groups))
                        }
                      />
                      <span>{formatToolbarOptionLabel(carePath)}</span>
                    </label>
                  ))}
                </div>
              );
            })}
            {!groups.length && (
              <p className="hc-toolbar-multiselect-empty hc-muted">No pathways in scope</p>
            )}
          </div>,
          document.body
        )}
    </div>
  );
}
