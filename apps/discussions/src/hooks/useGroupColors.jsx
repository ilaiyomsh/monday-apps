import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as MondayCtx from '../contexts/MondayContext.jsx';
import logger from '../utils/logger.js';
import { DISCUSSION_PALETTE } from '../components/MyTasksView/grouping.js';
import {
  loadGroupColors, saveGroupColors, groupColorsScope, withGroupColor, withoutGroupColor,
} from '../utils/groupColors.js';
import styles from './useGroupColors.module.css';

// Stable fallback context so a surface/test that mocks MondayContext.jsx without
// exporting the context object (only useMondayContext) still resolves cleanly —
// useContext returns null and the storage scope falls back to 'default'.
const FALLBACK_CTX = React.createContext(null);

/*
 * Group-header color overrides (round 77) — a hook that owns everything the
 * right-click "color this header" feature needs, so each GROUP BY view wires it
 * in with three lines:
 *   const { colorsByKey, openMenuFor, menu } = useGroupColors();
 *   ...ensureGroupColors(buckets, colorsByKey)... (color applied everywhere)
 *   onContextMenu={(e) => openMenuFor(grp.key, e)}   (on the header)
 *   {menu}                                            (once in the view)
 *
 * The chosen color is shared across ALL users of the instance (monday.storage,
 * per-instance) and is deliberately open to everyone — no owner gate. Picking a
 * swatch is optimistic; "אוטומטי" clears the override back to the auto color.
 */
export function useGroupColors() {
  // Read the monday context SOFTLY (useContext, not useMondayContext) so the
  // hook still works in surfaces/tests rendered without a MondayProvider — the
  // scope simply falls back to 'default' (same pattern as useTasks).
  const ctxApi = useContext(MondayCtx.MondayContext || FALLBACK_CTX);
  const scope = groupColorsScope(ctxApi?.context);
  const [colorsByKey, setColorsByKey] = useState({});
  // { groupKey, x, y } while the palette is open at the cursor; null when closed.
  const [menuState, setMenuState] = useState(null);
  const menuRef = useRef(null);

  // Load the shared override map once the scope is known.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const map = await loadGroupColors(scope);
        if (!cancelled) setColorsByKey(map || {});
      } catch (err) {
        // loadGroupColors already handles its own failures (returns {}); this is
        // defensive so a floating promise can never surface unhandled.
        if (!cancelled) logger.warn('useGroupColors', 'טעינת צבעי הכותרות נכשלה', err);
      }
    })();
    return () => { cancelled = true; };
  }, [scope]);

  const openMenuFor = useCallback((groupKey, event) => {
    if (groupKey == null) return;
    if (event) { event.preventDefault(); event.stopPropagation(); }
    // Anchor at the cursor, clamped so the palette never leaves the viewport.
    const W = 208; const H = 132;
    const x = Math.max(8, Math.min((event?.clientX ?? 40), window.innerWidth - W - 8));
    const y = Math.max(8, Math.min((event?.clientY ?? 40), window.innerHeight - H - 8));
    setMenuState({ groupKey: String(groupKey), x, y });
  }, []);

  const closeMenu = useCallback(() => setMenuState(null), []);

  const pick = useCallback((hex) => {
    if (!menuState) return;
    const gk = menuState.groupKey;
    setColorsByKey((prev) => {
      const next = hex ? withGroupColor(prev, gk, hex) : withoutGroupColor(prev, gk);
      saveGroupColors(scope, next); // fire-and-forget; logs on failure
      return next;
    });
    setMenuState(null);
  }, [menuState, scope]);

  // Close on outside click / Escape while open.
  useEffect(() => {
    if (!menuState) return undefined;
    const onDown = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) closeMenu(); };
    const onKey = (e) => { if (e.key === 'Escape') closeMenu(); };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [menuState, closeMenu]);

  const menu = menuState
    ? createPortal(
      <div
        ref={menuRef}
        className={styles.palette}
        style={{ left: menuState.x, top: menuState.y }}
        dir="rtl"
        role="menu"
        aria-label="בחירת צבע לכותרת הקבוצה"
        onContextMenu={(e) => e.preventDefault()}
      >
        <div className={styles.swatches}>
          {DISCUSSION_PALETTE.map((hex) => (
            <button
              key={hex}
              type="button"
              className={styles.swatch}
              style={{ background: hex }}
              title={hex}
              aria-label={`צבע ${hex}`}
              onClick={() => pick(hex)}
            />
          ))}
        </div>
        <button type="button" className={styles.clearBtn} onClick={() => pick(null)}>
          צבע אוטומטי
        </button>
      </div>,
      document.body,
    )
    : null;

  return { colorsByKey, openMenuFor, menu };
}

export default useGroupColors;
