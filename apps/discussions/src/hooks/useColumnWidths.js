import { useCallback } from 'react';
import { useColumnWidthsStore } from '../contexts/ColumnWidthsContext.jsx';

/*
 * Turns a per-table ordered column-def list into a `grid-template-columns` string
 * plus a drag handler, reading/writing the shared ColumnWidthsContext.
 *
 * columnDefs: ordered array for the CURRENTLY VISIBLE columns:
 *   { key, default, min, max }            -> resizable, width = stored ?? default
 *   { key, fixed }                        -> non-resizable fixed track (e.g. checkbox)
 *   { key, default, min, max, flex }      -> resizable FILL track: minmax(w, 1fr),
 *                                            so it absorbs the table's spare width
 *                                            and the drag adjusts its MINIMUM
 *
 * Returns { gridTemplate, startResize(key, mouseEvent), loading }. The same hook
 * is used by every table (parameterized by tableId) so load/save/debounce live
 * in one place. Mouse-only by design (handles are hidden on touch at the call site).
 */
export function useColumnWidths(tableId, columnDefs) {
  const { widths, setWidth, loading } = useColumnWidthsStore();
  const tableWidths = widths[tableId] || {};

  const gridTemplate = columnDefs
    .map((d) => {
      if (d.fixed != null) return `${d.fixed}px`;
      const w = tableWidths[d.key] ?? d.default;
      return d.flex ? `minmax(${w}px, 1fr)` : `${w}px`;
    })
    .join(' ');

  const startResize = useCallback(
    (key, e) => {
      const def = columnDefs.find((d) => d.key === key);
      if (!def || def.fixed != null) return;
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startW = (widths[tableId] || {})[key] ?? def.default;
      const min = def.min ?? 60;
      const max = def.max ?? 1200;

      const onMove = (ev) => {
        // dir="ltr" tables: handle is on the cell's right edge, so dragging right
        // grows the column.
        const next = Math.max(min, Math.min(max, Math.round(startW + (ev.clientX - startX))));
        setWidth(tableId, key, next);
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [columnDefs, tableId, widths, setWidth]
  );

  return { gridTemplate, startResize, loading };
}
