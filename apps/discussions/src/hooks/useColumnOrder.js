import { useCallback, useMemo } from 'react';
import { useColumnOrderStore } from '../contexts/ColumnOrderContext.jsx';
import { applyColumnOrder, moveColumn } from '../utils/columnOrder.js';

/*
 * Resolves the persisted column order for one table against its currently
 * visible columns, and exposes a reorder action. Parameterized by tableId so
 * load/save live once in ColumnOrderContext.
 *
 * visibleKeys: ordered array of the column keys CURRENTLY rendered (default
 *   order). pinned: keys forced to the front and not reorderable (frozen name).
 *
 * Returns { order, reorder(activeKey, overKey) }. `order` always starts with the
 * pinned keys and contains exactly the visible keys (see applyColumnOrder).
 */
export function useColumnOrder(tableId, visibleKeys, pinned = ['name']) {
  const { orders, setOrder } = useColumnOrderStore();
  const stored = orders[tableId];

  const order = useMemo(
    () => applyColumnOrder(visibleKeys, stored, pinned),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tableId, JSON.stringify(visibleKeys), JSON.stringify(stored), JSON.stringify(pinned)]
  );

  const reorder = useCallback(
    (activeKey, overKey) => {
      const next = moveColumn(order, activeKey, overKey);
      // Persist only the movable part is unnecessary — applyColumnOrder re-pins
      // on read, so storing the full order is safe and simplest.
      setOrder(tableId, next);
    },
    [order, setOrder, tableId]
  );

  return { order, reorder };
}
