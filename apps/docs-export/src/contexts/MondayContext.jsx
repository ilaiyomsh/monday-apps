/**
 * MondayContext — the single source of the monday iframe context.
 *
 * Three mechanisms, all load-bearing (ported from apps/discussions/src/contexts/MondayContext.jsx):
 *   1. monday.get('context')  — the initial fetch.
 *   2. monday.listen('context') — kept subscribed for the whole session. On MOBILE
 *      the initial get() can resolve empty and the context arrives only via this
 *      event, so this is not just for theme/language switches.
 *   3. A WATCHDOG — after CONTEXT_TIMEOUT_MS with no real context, install `{}` so
 *      the app renders a useful "not inside monday" state instead of hanging on a
 *      spinner forever (this is what you hit running `pnpm dev` without the mock).
 *
 * A serialized-diff guard drops monday's identical context re-emits, which are
 * frequent and would otherwise re-render the whole tree (and re-run every effect
 * keyed on `context`) several times per second.
 *
 * board_view context shape (captured live, apps/discussions/docs/sdk-instance-contexts.md):
 *   - `instanceId` === `boardViewId`, NOT boardId. Storage keys are per-instance, so a
 *     board_view and an object_view of the same app configure independently.
 *   - There is NO `boardPermissions` / `objectPermissions` on a board_view, so owner
 *     detection MUST query the API (services/owners.js) — it cannot read the context.
 */
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { setAxiomContext } from '@mapps/error-kit/browser';
import { monday } from '../services/monday-sdk';
import logger from '../utils/logger';

const CONTEXT_TIMEOUT_MS = 4000;

// Languages rendered right-to-left. index.html ships dir="rtl" as the default;
// this re-syncs direction + lang from the live context so LTR users get LTR.
const RTL_LANGUAGES = ['he', 'ar', 'fa', 'ur'];

function applyLocale(context) {
  const lang = context?.user?.currentLanguage;
  if (!lang) return;
  document.documentElement.setAttribute('dir', RTL_LANGUAGES.includes(lang) ? 'rtl' : 'ltr');
  document.documentElement.setAttribute('lang', lang);
}

function applyTheme(context) {
  const theme = context?.theme;
  if (!theme) return;
  // monday themes: light | dark | night | black.
  document.body.classList.remove(
    'light-app-theme',
    'dark-app-theme',
    'night-app-theme',
    'black-app-theme'
  );
  document.body.classList.add(`${theme}-app-theme`);
}

const MondayCtx = createContext({ context: null, currentUser: null, isMobile: false });

export function MondayProvider({ children }) {
  const [context, setContext] = useState(null);
  // Serialized snapshot of the last context we accepted — the diff guard.
  const lastSerializedRef = useRef(null);
  // Whether a REAL context ever arrived (vs the watchdog's `{}`).
  const realContextRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const handleContext = (res) => {
      const data = res?.data;
      if (cancelled || !data) return;

      // Drop monday's identical re-emits before they cause a re-render.
      let serialized;
      try {
        serialized = JSON.stringify(data);
      } catch (err) {
        // Unserializable context (circular) — accept it rather than lose it; the
        // diff guard just stops working for this one emit.
        logger.warn('MondayContext', 'context_not_serializable', err);
        serialized = null;
      }
      if (serialized !== null && serialized === lastSerializedRef.current) return;
      lastSerializedRef.current = serialized;

      realContextRef.current = true;
      applyLocale(data);
      applyTheme(data);

      // Debug affordance: copy(window.__mondayContext) in the console.
      window.__mondayContext = data;

      // Enrich every remote error record with iframe identity. Merge semantics —
      // `undefined` never clobbers a previously-set field.
      setAxiomContext({
        accountId: data.account?.id ?? data.accountId,
        userId: data.user?.id,
        boardId: data.boardId ?? (Array.isArray(data.boardIds) ? data.boardIds[0] : undefined),
        instanceId: data.instanceId,
      });

      setContext(data);
    };

    monday
      .get('context')
      .then(handleContext)
      .catch((err) => {
        // Non-fatal: the listener and the watchdog are both still in play.
        logger.warn('MondayContext', 'initial_context_fetch_failed', err);
      });

    const unsubscribe = monday.listen('context', handleContext);

    // Watchdog — never hang on a spinner when there is no monday around us.
    const watchdog = setTimeout(() => {
      if (cancelled || realContextRef.current) return;
      logger.warn('MondayContext', 'context_timeout_using_empty', {
        timeoutMs: CONTEXT_TIMEOUT_MS,
      });
      setContext((prev) => prev ?? {});
    }, CONTEXT_TIMEOUT_MS);

    return () => {
      cancelled = true;
      clearTimeout(watchdog);
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, []);

  const value = useMemo(
    () => ({
      context,
      currentUser: context?.user ?? null,
      isMobile: context?.mode === 'mobile',
    }),
    [context]
  );

  return <MondayCtx.Provider value={value}>{children}</MondayCtx.Provider>;
}

export function useMonday() {
  return useContext(MondayCtx);
}

export default MondayCtx;
