import { useCallback, useEffect, useRef, useState } from 'react';
import { loadRowOrder, saveRowOrder, applyRowOrder } from '../utils/rowOrder.js';

/*
 * Whole-row drag-reorder persistence for a FLAT list, keyed by a stable `scope`
 * string (see utils/rowOrder.js). Generalizes the Topics reorder workaround to
 * the Previous / Tasks / Decisions tables — monday has no item-position API, so
 * the order lives in monday.storage and is re-applied on read.
 *
 * Usage:
 *   const { order, orderList, onDragEnd, enabled } = useRowOrder(scope, items, { enabled });
 *   // render `orderList` (items sorted by the saved order) inside a
 *   // <DndContext onDragEnd={onDragEnd}><SortableContext items={order}> … </>
 *
 * - `items`  : the source array of { id } (already filtered/loaded by the tab).
 * - `enabled`: gate (e.g. not grouped-by-something-else, not mobile). When
 *              false the list passes through untouched and drag is a no-op.
 *
 * Returns:
 *   order      — string[] of ids in display order (for <SortableContext items>).
 *   orderList  — the items sorted by that order (unknown ids kept at the end).
 *   onDragEnd  — dnd-kit handler; reorders locally + persists (real ids only).
 *   enabled    — echoed back for convenience.
 */
export function useRowOrder(scope, items, { enabled = true } = {}) {
  const [savedOrder, setSavedOrder] = useState([]);
  const scopeRef = useRef(scope);

  // (Re)load the saved order whenever the scope changes.
  useEffect(() => {
    scopeRef.current = scope;
    let cancelled = false;
    if (!scope || !enabled) { setSavedOrder([]); return () => { cancelled = true; }; }
    (async () => {
      const ids = await loadRowOrder(scope);
      if (!cancelled && scopeRef.current === scope) setSavedOrder(ids);
    })();
    return () => { cancelled = true; };
  }, [scope, enabled]);

  const orderList = enabled ? applyRowOrder(items || [], savedOrder) : (items || []);
  const order = orderList.map((it) => String(it.id));

  const onDragEnd = useCallback(
    ({ active, over }) => {
      if (!enabled || !over || active.id === over.id) return;
      const ids = orderList.map((it) => String(it.id));
      const from = ids.indexOf(String(active.id));
      const to = ids.indexOf(String(over.id));
      if (from < 0 || to < 0) return;
      const next = [...ids];
      next.splice(from, 1);
      next.splice(to, 0, String(active.id));
      setSavedOrder(next);
      // Persist real ids only — a still-saving optimistic row (temp- id) has no
      // board id yet, so it lands in API order on the next read (matches the
      // Topics reorder persistence rule).
      saveRowOrder(scope, next.filter((id) => !id.startsWith('temp-')));
    },
    [enabled, orderList, scope]
  );

  return { order, orderList, onDragEnd, enabled };
}
