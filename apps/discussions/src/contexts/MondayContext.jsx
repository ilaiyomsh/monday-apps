import React, { createContext, useContext, useState, useEffect, useMemo, useRef } from 'react';
import { monday } from '../utils/mondayApi/monday-client.js';
import logger from '../utils/logger.js';

// Diagnostic helper: log a raw SDK payload as BOTH an explorable object and a
// copy-paste-friendly JSON string. Permanent (see enableDebugLogs()). Used to
// compare how the same bundle is addressed as a board_view vs a custom object.
const dumpRaw = (label, data) => {
  logger.info('MondayContext', `🔎 ${label} (object)`, data);
  let json;
  try { json = JSON.stringify(data, null, 2); } catch { json = '[unserializable]'; }
  logger.info('MondayContext', `🔎 ${label} (JSON — copy this)`, json);
};

/*
 * Loads the monday SDK context ONCE and exposes it to the app. Mirrors the
 * tracker pattern: monday.get('context') + a permanent listen() (mobile may
 * only deliver via the event) + a watchdog that installs an empty context as
 * fallback so the app never hangs waiting for a frame that won't answer
 * (e.g. local dev outside monday).
 */
// Exported so lightweight consumers (e.g. useViewport) can read the context
// SOFTLY via useContext — tolerating a null/absent provider in unit tests —
// without the throw that useMondayContext() enforces.
export const MondayContext = createContext(null);

export function MondayProvider({ children }) {
  const [context, setContext] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);

  // Last values we published, serialized. monday re-emits `context` on many
  // interactions (e.g. opening an item card), often with IDENTICAL data — without
  // these guards every echo would create new object refs and re-render the whole
  // subtree for no reason. We only setState when something actually changed.
  const lastContextRef = useRef(null);
  const lastUserRef = useRef(null);

  useEffect(() => {
    let realContextLoaded = false;

    const handleContext = (res) => {
      if (!res?.data) return;
      realContextLoaded = true;
      const serialized = JSON.stringify(res.data);
      if (serialized !== lastContextRef.current) {
        lastContextRef.current = serialized;
        // Debug: expose the raw context on window so it can be read from the
        // console regardless of log level — `copy(window.__mondayContext)`.
        if (typeof window !== 'undefined') window.__mondayContext = res.data;
        dumpRaw('RAW SDK CONTEXT', res.data);
        setContext(res.data);
      }
      if (res.data.user) {
        const next = { id: res.data.user.id || null, name: res.data.user.name || '' };
        const userKey = `${next.id}|${next.name}`;
        if (userKey !== lastUserRef.current) {
          lastUserRef.current = userKey;
          setCurrentUser(next);
        }
      }
    };

    monday.get('context').then(handleContext).catch(() => {});
    const unsubscribe = monday.listen('context', handleContext);

    const watchdog = setTimeout(() => {
      if (!realContextLoaded) setContext((prev) => prev ?? {});
    }, 4000);

    return () => {
      clearTimeout(watchdog);
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, []);

  const isMobile = context?.mode === 'mobile';

  const value = useMemo(
    () => ({ context, currentUser, isMobile }),
    [context, currentUser, isMobile]
  );

  return <MondayContext.Provider value={value}>{children}</MondayContext.Provider>;
}

export function useMondayContext() {
  const value = useContext(MondayContext);
  if (value === null) {
    throw new Error('useMondayContext must be used within a MondayProvider');
  }
  return value;
}
