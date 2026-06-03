import { useEffect, useLayoutEffect, type RefObject } from 'react';

export const MENU_VIEWPORT_MARGIN_PX = 8;
export const MENU_TRIGGER_GAP_PX = 4;
export const MENU_MIN_HEIGHT_PX = 120;
const MENU_Z_INDEX = 1000;

export function useToolbarMultiselectDismiss(
  open: boolean,
  rootRef: RefObject<HTMLElement | null>,
  menuRef: RefObject<HTMLElement | null>,
  onClose: () => void
): void {
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open, onClose, rootRef, menuRef]);
}

/** Pins the menu to the trigger with fixed positioning so overflow:hidden ancestors cannot clip it. */
export function useToolbarMultiselectFloatingMenu(
  open: boolean,
  rootRef: RefObject<HTMLDivElement | null>,
  menuRef: RefObject<HTMLDivElement | null>,
  layoutDeps: readonly unknown[] = []
): void {
  useLayoutEffect(() => {
    if (!open) return;

    const updatePosition = () => {
      const root = rootRef.current;
      const menu = menuRef.current;
      if (!root || !menu) return;

      const trigger = root.querySelector<HTMLElement>('.hc-toolbar-multiselect-trigger');
      if (!trigger) return;

      const rect = trigger.getBoundingClientRect();
      const spaceBelow =
        window.innerHeight - rect.bottom - MENU_VIEWPORT_MARGIN_PX - MENU_TRIGGER_GAP_PX;

      menu.style.position = 'fixed';
      menu.style.top = `${rect.bottom + MENU_TRIGGER_GAP_PX}px`;
      menu.style.left = `${rect.left}px`;
      menu.style.minWidth = `${rect.width}px`;
      menu.style.maxHeight = `${Math.max(MENU_MIN_HEIGHT_PX, spaceBelow)}px`;
      menu.style.zIndex = String(MENU_Z_INDEX);
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);

    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
      const menu = menuRef.current;
      if (!menu) return;
      menu.style.position = '';
      menu.style.top = '';
      menu.style.left = '';
      menu.style.minWidth = '';
      menu.style.maxHeight = '';
      menu.style.zIndex = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- layoutDeps are caller-specific (options length, etc.)
  }, [open, rootRef, menuRef, ...layoutDeps]);
}
