import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react';

const DEFAULT_MIN_WIDTH_PX = 48;

type ColumnWidths = Record<string, number>;

type ResizeSession = {
  columnId: string;
  startX: number;
  startWidth: number;
};

export function useResizableTableColumns(
  tableRef: RefObject<HTMLTableElement | null>,
  columnIds: readonly string[],
  enabled: boolean,
  minWidth = DEFAULT_MIN_WIDTH_PX
) {
  const [columnWidths, setColumnWidths] = useState<ColumnWidths | null>(null);
  const columnWidthsRef = useRef<ColumnWidths | null>(null);
  const resizeSessionRef = useRef<ResizeSession | null>(null);
  columnWidthsRef.current = columnWidths;

  useLayoutEffect(() => {
    if (!enabled || columnWidths !== null) return;

    const table = tableRef.current;
    if (!table) return;

    const headerCells = table.querySelectorAll('thead tr:first-child th');
    if (headerCells.length !== columnIds.length) return;

    const measured: ColumnWidths = {};
    columnIds.forEach((columnId, index) => {
      measured[columnId] = headerCells[index].getBoundingClientRect().width;
    });
    setColumnWidths(measured);
  }, [columnIds, columnWidths, enabled, tableRef]);

  const startResize = useCallback(
    (columnId: string, clientX: number) => {
      if (!enabled) return;

      const current = columnWidthsRef.current;
      if (!current) return;

      resizeSessionRef.current = {
        columnId,
        startX: clientX,
        startWidth: current[columnId],
      };

      const onMouseMove = (event: MouseEvent) => {
        const session = resizeSessionRef.current;
        if (!session) return;

        const delta = event.clientX - session.startX;
        const nextWidth = Math.max(minWidth, Math.round(session.startWidth + delta));

        setColumnWidths((current) => {
          if (!current) return current;
          return { ...current, [session.columnId]: nextWidth };
        });
      };

      const onMouseUp = () => {
        resizeSessionRef.current = null;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        document.body.classList.remove('hc-table-col-resizing');
      };

      document.body.classList.add('hc-table-col-resizing');
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    },
    [enabled, minWidth]
  );

  const getColumnStyle = useCallback(
    (columnId: string): { width: string } | undefined => {
      if (!columnWidths) return undefined;

      const total = columnIds.reduce(
        (sum, id) => sum + (columnWidths[id] ?? 0),
        0
      );
      if (total <= 0) return undefined;

      const percent = ((columnWidths[columnId] ?? 0) / total) * 100;
      return { width: `${percent}%` };
    },
    [columnIds, columnWidths]
  );

  return {
    columnWidths,
    getColumnStyle,
    startResize,
  };
}
