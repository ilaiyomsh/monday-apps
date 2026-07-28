/**
 * Global Error Handler (error-guard template)
 * ------------------------------------------------------------------------
 * Catches everything the app failed to catch and routes it to the canonical
 * logging point. Display to the user is NOT done here ג€” a UI sink (see the
 * useUiErrorSink template) listens for ERROR log records and renders exactly
 * one toast per record.
 *
 * Single-logging-point contract:
 *   For uncaught errors and unhandled rejections, THIS handler owns the
 *   canonical log record. `logger.error(...)` runs through the logger's single
 *   emit point, which stamps a non-enumerable `__loggedId` on the error object.
 *   Downstream display layers (UI sink, showErrorWithDetails) de-dupe against
 *   `__loggedId` and therefore skip re-logging the same error. Do NOT add a
 *   second `logger.*` call for the same error object elsewhere on the path.
 *
 * Import-order-safe: this module has no top-level side effects and no DOM/React
 * dependency, so it can be imported and `setupGlobalErrorHandlers()` can be
 * called at the earliest point of the bundle, before React mounts.
 *
 * Idempotent: calling `setupGlobalErrorHandlers()` more than once does not
 * double-register the listeners (guarded via a window flag, with a module-level
 * fallback for non-browser environments).
 *
 * Dependencies: the logger peer module only. Vanilla JS otherwise.
 */

import logger from './logger';

// ---------------------------------------------------------------------------
// Chunk-load seam (optional, injectable)
// ---------------------------------------------------------------------------
// Chunk-load failures (new deploy, dropped network, wrong MIME type when a CDN
// returns index.html instead of a JS chunk) are handled by a lazyRetry-style
// single-reload path, NOT by logging + toast. That path lives in a peer module
// (see the error-guard lazyRetry template) and exposes a function with the
// contract:
//
//     handleChunkError(error) => boolean
//         true  -> this was a chunk error; a single reload was triggered (or
//                  suppressed because the one-reload budget is already spent).
//                  The caller should `event.preventDefault()` and stop.
//         false -> not a chunk error; the caller handles it normally.
//
// The seam is kept but made OPTIONAL so this template compiles in an app that
// has no lazyRetry yet. Wire it in one of two ways:
//   1. Pass it at setup:  setupGlobalErrorHandlers({ handleChunkError })
//   2. Register it once:   setChunkErrorHandler(handleChunkError)
// If neither is wired, chunk detection is skipped and chunk errors fall through
// to normal logging (safe, just no auto-reload).
let chunkErrorHandler = null;

/**
 * Register the optional chunk-load handler (see seam contract above).
 * Pass a function, or null/undefined to clear it.
 * @param {(error: unknown) => boolean | null | undefined} fn
 */
export const setChunkErrorHandler = (fn) => {
    chunkErrorHandler = typeof fn === 'function' ? fn : null;
};

/**
 * Run the currently-wired chunk handler, if any. Never throws.
 * @param {unknown} error
 * @returns {boolean} true if the error was consumed as a chunk-load failure.
 */
const tryHandleChunkError = (error) => {
    if (typeof chunkErrorHandler !== 'function') return false;
    try {
        return chunkErrorHandler(error) === true;
    } catch (handlerError) {
        // A broken chunk handler must not swallow the original error. Record the
        // handler failure and report the error normally by returning false.
        logger.warn('globalErrorHandler', 'chunkErrorHandler threw; falling back to normal logging', handlerError);
        return false;
    }
};

// ---------------------------------------------------------------------------
// Canonical logging entry
// ---------------------------------------------------------------------------

/**
 * Canonical log point for an uncaught error / unhandled rejection.
 * `logger.error` stamps `__loggedId` (log-once), so the UI sink displays it once
 * and no downstream layer re-logs it.
 * @param {unknown} error
 * @param {{ functionName?: string }} [context]
 */
export const handleGlobalError = (error, context = {}) => {
    const functionName = context.functionName || 'GlobalErrorHandler';
    logger.error(functionName, 'Global error caught', error);
};

// ---------------------------------------------------------------------------
// Idempotency guard
// ---------------------------------------------------------------------------
// Prefer a window flag so duplicate module instances (bundler edge cases,
// re-imports) still register only once. Fall back to a module-level flag when
// there is no window (SSR / tests).
let moduleInstalled = false;

const alreadyInstalled = () => {
    if (typeof window !== 'undefined') return window.__errorGuardHandlersInstalled === true;
    return moduleInstalled;
};

const markInstalled = () => {
    if (typeof window !== 'undefined') {
        window.__errorGuardHandlersInstalled = true;
    }
    moduleInstalled = true;
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

/**
 * Register the global error listeners: capture-phase resource errors, window
 * 'error' (uncaught JS), and 'unhandledrejection'. Safe to call before React
 * mounts. Calling more than once is a no-op after the first successful install.
 *
 * @param {Object} [options]
 * @param {(error: unknown) => boolean} [options.handleChunkError]
 *        Optional lazyRetry-style chunk handler (see seam contract above). When
 *        provided it is registered via setChunkErrorHandler before wiring.
 */
export const setupGlobalErrorHandlers = (options = {}) => {
    // No window -> nothing to attach to (SSR / non-browser). Still allow the
    // chunk handler to be registered so a later browser-side call can use it.
    if (options && typeof options.handleChunkError === 'function') {
        setChunkErrorHandler(options.handleChunkError);
    }
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
        return;
    }
    if (alreadyInstalled()) return;
    markInstalled();

    // --- Resource load failures (script / link / img) ---
    // These do NOT bubble, so a capture-phase listener on window is required.
    // Useful for a failed main bundle, a failed preload tag, or a CDN that
    // returned HTML for a chunk request.
    window.addEventListener('error', (event) => {
        const target = event.target;
        // A real uncaught JS error has target === window; let the bubble-phase
        // 'error' listener below own it. Here we only handle element targets.
        if (!target || target === window) return;
        const tag = target.tagName;
        if (tag !== 'SCRIPT' && tag !== 'LINK' && tag !== 'IMG') return;

        const url = target.src || target.href || '';
        // Resource error events carry no `message`; the chunk detector matches
        // on message text, so build a pseudo-error for it.
        const pseudoError = new Error(`Failed to load resource: ${url}`);
        if (tryHandleChunkError(pseudoError)) {
            event.preventDefault();
            return;
        }

        // FIX (Tracker audit gap): a NON-chunk resource failure (a stylesheet,
        // image, or non-chunk script that failed to load) previously fell
        // through this branch silently and was never recorded. Warn ג€” not error
        // ג€” because a missing asset should not pop an error toast, but it must
        // be visible in logs with its URL and tag.
        logger.warn('globalErrorHandler', 'Resource failed to load', { url, tag });
    }, true);

    // --- Unhandled promise rejections ---
    window.addEventListener('unhandledrejection', (event) => {
        const error = event.reason;

        // Chunk-load failure -> single-reload path owns it.
        if (tryHandleChunkError(error)) {
            event.preventDefault();
            return;
        }

        // Canonical record for the uncaught rejection.
        handleGlobalError(error, {
            functionName: 'UnhandledPromiseRejection'
        });
    });

    // --- Uncaught errors (bubble phase) ---
    window.addEventListener('error', (event) => {
        const error = event.error;

        // Chunk-load failure -> single-reload path owns it.
        if (tryHandleChunkError(error)) {
            event.preventDefault();
            return;
        }

        // Canonical record for the uncaught error.
        handleGlobalError(error, {
            functionName: 'UncaughtError'
        });
    });
};

const globalErrorHandlerExports = {
    handleGlobalError,
    setupGlobalErrorHandlers,
    setChunkErrorHandler
};
export default globalErrorHandlerExports;

