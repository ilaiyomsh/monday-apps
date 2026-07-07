import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { monday } from '../utils/mondayApi/monday-client.js';
import { useMondayContext } from './MondayContext.jsx';
import { COLUMN_ORDER_STORAGE_KEY } from '../constants/columnWidths.js';
import logger from '../utils/logger.js';

/*
 * Draggable column-ORDER store — persisted per app instance in monday.storage,
 * a direct mirror of ColumnWidthsContext (key + 5s timeout + JSON + instanceId
 * fallback, NON-blocking, ref-backed so the debounced save reads the latest).
 *
 * Scope = per-instance (shared by all viewers), owner-drags-only (gated at the
 * call site) — matching Settings / Templates / topicOrder / column widths.
 *
 * Stored shape: { [tableId]: [orderedColumnKeys] } — only tables whose order was
 * changed are stored; the rest fall back to each table's code-default order.
 */
const TIMEOUT_MS = 5000;
const SAVE_DEBOUNCE_MS = 400;

const ColumnOrderContext = createContext(null);
let missingProviderWarned = false;

function instanceKey(context) {
  const id = context?.instanceId || context?.boardId || 'default';
  return `${COLUMN_ORDER_STORAGE_KEY}_${id}`;
}

export function ColumnOrderProvider({ children }) {
  const { context } = useMondayContext();
  const [orders, setOrders] = useState({});
  const ordersRef = useRef({});
  const [loading, setLoading] = useState(true);
  const loadedRef = useRef(false);
  const saveTimerRef = useRef(null);

  const load = useCallback(async () => {
    const withTimeout = (p) =>
      Promise.race([
        p,
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), TIMEOUT_MS)),
      ]);
    try {
      const res = await withTimeout(monday.storage.getItem(instanceKey(context)));
      if (res?.data?.value) {
        const saved = JSON.parse(res.data.value);
        const obj = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
        ordersRef.current = obj;
        setOrders(obj);
      } else {
        ordersRef.current = {};
        setOrders({});
      }
    } catch {
      // storage unavailable / parse error — start with defaults, never block render.
      ordersRef.current = {};
      setOrders({});
    }
    setLoading(false);
  }, [context]);

  useEffect(() => {
    if (!context || loadedRef.current) return;
    loadedRef.current = true;
    load();
  }, [context, load]);

  const persistSoon = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      try {
        await monday.storage.setItem(instanceKey(context), JSON.stringify(ordersRef.current));
      } catch (err) {
        logger.warn('ColumnOrderContext', 'שמירת סדר העמודות נכשלה (נשמר בזיכרון בלבד)', err);
      }
    }, SAVE_DEBOUNCE_MS);
  }, [context]);

  const setOrder = useCallback(
    (tableId, keys) => {
      const cur = ordersRef.current;
      const next = { ...cur, [tableId]: [...keys] };
      ordersRef.current = next;
      setOrders(next);
      persistSoon();
    },
    [persistSoon]
  );

  useEffect(
    () => () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    },
    []
  );

  return (
    <ColumnOrderContext.Provider value={{ orders, setOrder, loading }}>
      {children}
    </ColumnOrderContext.Provider>
  );
}

export function useColumnOrderStore() {
  const ctx = useContext(ColumnOrderContext);
  if (!ctx) {
    if (!missingProviderWarned) {
      logger.warn('ColumnOrderContext', 'useColumnOrderStore called without provider; ordering disabled.');
      missingProviderWarned = true;
    }
    return { orders: {}, setOrder: () => {}, loading: false };
  }
  return ctx;
}
