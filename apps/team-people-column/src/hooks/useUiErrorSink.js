/**
 * UI Error Sink (error-guard template)
 * ------------------------------------------------------------------------
 * The one place in the app that turns a logged ERROR into something the user
 * sees. Register this hook ONCE, near the app root (above/alongside the error
 * boundary, inside whatever provider owns the toast state). It:
 *
 *   1. Subscribes to `logger.addSink` and, for every ERROR-level record,
 *      calls the injected `showToast` exactly once.
 *   2. Skips records whose `module` starts with `'ErrorBoundary'` (e.g.
 *      `'ErrorBoundary:root'`) — a render throw
 *      already gets a full fallback screen from the boundary; a toast on top
 *      of that would be a duplicate, lower-value signal for the same failure.
 *   3. Dedupes: `logger`'s `emit` already marks a repeat pass of the same
 *      Error instance as `record.duplicate` and skips sink dispatch for it
 *      (log-once, keyed by `record.correlationId` / `error.__loggedId`). This
 *      hook additionally dedupes its own ring-buffer replay by
 *      `correlationId` so a buffered duplicate can't produce a second toast.
 *   4. Replays early-init errors: any ERROR record that was emitted into the
 *      logger's ring buffer BEFORE this hook mounted (e.g. an error during
 *      module init, before the toast provider existed) is replayed once on
 *      mount, capped at REPLAY_CAP records, oldest-first.
 *   5. Builds a generic `details` object from the record (module, message,
 *      timestamp, correlationId, context, and the underlying error/data) and
 *      hands it to `showToast` as a 4th argument, so the app's toast UI can
 *      offer a "details" action that opens a details modal without this hook
 *      knowing anything about that modal's shape.
 *
 * Single-responsibility contract: this hook DISPLAYS, it never LOGS. If a
 * failure inside the display path itself needs recording, that is the job of
 * `dispatchToSinks`'s own try/catch in the logger (it reports sink failures
 * via raw `console.error` precisely so this hook does not have to re-enter
 * the logger). Do not add a `logger.*` call inside `uiHandler`.
 *
 * Toast mechanism is injectable — this template imports NO toast library.
 * Pass whatever `showToast` your app already has; the assumed call shape is:
 *
 *     showToast(message: string, type: 'error', autoCloseMs: number, details: object)
 *
 * If your toast API differs, adapt the single call site inside `uiHandler`
 * (search for `showToastRef.current(`) — everything else in this file is
 * toast-library-agnostic.
 *
 * Dependencies: the app's `logger` module only (must expose `addSink` and
 * `getBuffer`, matching the error-guard `logger.js` template's contract).
 */

import { useEffect, useRef } from 'react';
import logger from '../utils/logger';

/**
 * How long an error toast stays visible before auto-closing (ms).
 * Not sticky by default — adjust per app if errors need to persist longer.
 */
export const AUTO_CLOSE_MS = 6000;

/**
 * Cap on how many buffered ERROR records get replayed on mount (early-init
 * errors that fired before this hook subscribed). The cap bounds the
 * ring-buffer replay to a small, recent set; it is not a cap on how many
 * toasts can ever show — after mount every new ERROR record still gets one.
 */
export const REPLAY_CAP = 5;

/**
 * Fallback message shown when neither the error nor the log record carries
 * a user-facing string. Replace/localize per app; kept generic here.
 */
const DEFAULT_MESSAGE = 'אירעה שגיאה';

/**
 * Build a generic, app-agnostic details object from a log record for a
 * details modal. Deliberately does NOT depend on any app-specific error
 * parser/catalog (e.g. a monday-API error-code-to-message map) — that kind
 * of enrichment belongs to the app and can be layered in by wrapping
 * `showToast` before passing it to this hook, or by having the app's error
 * classes carry a `.userMessage` (read below).
 *
 * @param {Object} record - a log record as produced by the app's logger
 * @returns {Object} details - safe to JSON.stringify (no circular refs beyond
 *   whatever the underlying Error/data object itself carries)
 */
const buildDetails = (record) => {
    const err = record.error ?? (record.data && typeof record.data === 'object' ? record.data : null);
    return {
        module: record.module,
        message: record.message,
        timestamp: record.timestamp,
        timestampISO: record.timestampISO,
        correlationId: record.correlationId ?? null,
        context: record.context ?? null,
        error: err instanceof Error
            ? { name: err.name, message: err.message, stack: err.stack ?? null }
            : (err ?? null),
    };
};

/**
 * Resolve the user-facing message for a record. Prefers a `.userMessage`
 * carried by the underlying error/data (the seam for an app-specific error
 * parser to plug in upstream, e.g. a typed API-error class), and otherwise
 * falls back to the generic Hebrew default. Deliberately does not fall back
 * to the raw technical `record.message` — that is a log label, not a message
 * fit for an end user.
 *
 * @param {Object} record
 * @returns {string}
 */
const resolveUserMessage = (record) => {
    const err = record.error ?? record.data;
    if (err && typeof err === 'object' && typeof err.userMessage === 'string' && err.userMessage) {
        return err.userMessage;
    }
    return DEFAULT_MESSAGE;
};

/**
 * UI Error Sink — the single display path for logged errors.
 *
 * @param {Object} deps
 * @param {function(message: string, type: string, autoCloseMs: number, details: Object): void} deps.showToast
 *   Injected toast callback. Not imported from any specific toast library —
 *   pass your app's existing toast function (or a small adapter around it).
 */
export const useUiErrorSink = ({ showToast }) => {
    // Ref to the latest showToast so the sink subscription (mounted once)
    // never closes over a stale callback without having to re-subscribe.
    const showToastRef = useRef(showToast);
    useEffect(() => { showToastRef.current = showToast; }, [showToast]);

    // Synchronous re-entrancy guard: prevents a throw inside the handler
    // itself (e.g. showToast throwing) from recursing back through emit.
    const inSinkRef = useRef(false);

    useEffect(() => {
        const uiHandler = (record) => {
            if (record.level !== 'ERROR') return;
            // Render crashes already get a full fallback screen from the error
            // boundary — one display path per error, not two. The record is
            // still in the logger's buffer for any future remote sink.
            if (typeof record.module === 'string' && record.module.startsWith('ErrorBoundary')) return;
            if (inSinkRef.current) return;
            inSinkRef.current = true;
            try {
                const details = buildDetails(record);
                const userMessage = resolveUserMessage(record);
                showToastRef.current(userMessage, 'error', AUTO_CLOSE_MS, details);
            // Deliberate, sole silent catch in this file: this IS the sink.
            // Calling the logger from here would recurse through emit (exactly
            // what inSinkRef guards against). The logger's own dispatchToSinks
            // try/catch already reports a throwing sink via raw console.error.
            // eslint-disable-next-line no-restricted-syntax
            } catch {
                // see comment above the catch
            } finally {
                inSinkRef.current = false;
            }
        };

        const unsubscribe = logger.addSink(uiHandler);

        // --- Buffer replay: early-init ERROR records emitted before mount ---
        // `duplicate` records are skipped (the original occurrence already
        // replays); de-dupe additionally by correlationId within the replay
        // batch itself, capped at REPLAY_CAP, oldest-first.
        const errorRecords = logger.getBuffer().filter((r) => r.level === 'ERROR' && !r.duplicate);
        const seen = new Set();
        const toReplay = [];
        for (let i = errorRecords.length - 1; i >= 0 && toReplay.length < REPLAY_CAP; i--) {
            const r = errorRecords[i];
            if (r.correlationId && seen.has(r.correlationId)) continue;
            if (r.correlationId) seen.add(r.correlationId);
            toReplay.push(r);
        }
        toReplay.reverse().forEach(uiHandler);

        return unsubscribe;
        // Runs once on mount by design — uiHandler reads showToast via a ref,
        // and everything else it touches is module-level or a ref, so an empty
        // dependency array is exact (no eslint-disable needed; a directive for
        // react-hooks/exhaustive-deps breaks `eslint .` in apps that do not
        // install eslint-plugin-react-hooks).
    }, []);
};

export default useUiErrorSink;
