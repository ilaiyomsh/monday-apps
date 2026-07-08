import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { monday } from '../utils/mondayApi/monday-client.js';
import { useMondayContext } from './MondayContext.jsx';
import { COLUMN_WIDTHS_STORAGE_KEY } from '../constants/columnWidths.js';
import logger from '../utils/logger.js';

/*
 * Draggable column-width store — persisted per app instance in monday.storage,
 * mirroring TemplatesContext (key + 5s timeout + JSON + instanceId fallback,
 * NON-blocking, ref-backed so the debounced save reads the latest value).
 *
 * Scope = per-instance (shared by all viewers of the board), matching Settings/
 * Templates/topicOrder — NOT per-user. Only board owners drag (gated at the call
 * site); everyone gets the stored widths applied.
 *
 * Stored shape: { [tableId]: { [columnKey]: pxNumber } } — only DRAGGED columns
 * are stored; the rest fall back to the code defaults in constants/columnWidths.
 */
const TIMEOUT_MS = 5000;
const SAVE_DEBOUNCE_MS = 400;

const ColumnWidthsContext = createContext(null);
let missingProviderWarned = false;

function instanceKey(context) {
  const id = context?.instanceId || context?.boardId || 'default';
  return `${COLUMN_WIDTHS_STORAGE_KEY}_${id}`;
}

export function ColumnWidthsProvider({ children }) {
  const { context } = useMondayContext();
  const [widths, setWidths] = useState({});
  const widthsRef = useRef({});
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
        widthsRef.current = obj;
        setWidths(obj);
      } else {
        widthsRef.current = {};
        setWidths({});
      }
    } catch {
      // storage unavailable / parse error — start with defaults, never block render.
      widthsRef.current = {};
      setWidths({});
    }
    setLoading(false);
  }, [context]);

  // Wait until the parent frame identifies the instance, then load once.
  useEffect(() => {
    if (!context || loadedRef.current) return;
    loadedRef.current = true;
    load();
  }, [context, load]);

  const persistSoon = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      try {
        await monday.storage.setItem(instanceKey(context), JSON.stringify(widthsRef.current));
      } catch (err) {
        // Width persistence is non-critical — log quietly, never throw/toast
        // (mirrors topicOrder / Templates tolerance).
        logger.warn('ColumnWidthsContext', 'שמירת רוחב העמודות נכשלה (נשמר בזיכרון בלבד)', err);
      }
    }, SAVE_DEBOUNCE_MS);
  }, [context]);

  // Live state update on every drag tick; storage write is debounced.
  const setWidth = useCallback(
    (tableId, key, px) => {
      const cur = widthsRef.current;
      const next = { ...cur, [tableId]: { ...(cur[tableId] || {}), [key]: px } };
      widthsRef.current = next;
      setWidths(next);
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
    <ColumnWidthsContext.Provider value={{ widths, setWidth, loading }}>
      {children}
    </ColumnWidthsContext.Provider>
  );
}

export function useColumnWidthsStore() {
  const ctx = useContext(ColumnWidthsContext);
  if (!ctx) {
    if (!missingProviderWarned) {
      logger.warn('ColumnWidthsContext', 'useColumnWidthsStore called without provider; widths disabled.');
      missingProviderWarned = true;
    }
    return { widths: {}, setWidth: () => {}, loading: false };
  }
  return ctx;
}
