/**
 * globalErrorHandler.ts — global error capture funnelled into the admin SPA logger.
 *
 * Vendored from the canonical error-kit browser source
 * (packages/error-kit/src/browser/globalErrorHandler.ts) — deadline-confirm is a
 * SERVER app whose monday-code push resolves NO workspace deps, so this client
 * bundle keeps a LOCAL copy (the `Logger` type is narrowed to the two methods this
 * module calls instead of importing error-kit's).
 *
 * Semantics (team-people-column's, the correct ones): a CAPTURE-PHASE window
 * 'error' listener for resource-load failures (script/link/img — they do NOT
 * bubble, so only capture sees them), an idempotency guard (a window flag with a
 * module-level fallback for non-browser/test), and an optional chunk-error seam.
 * Resource failures log at WARN (a missing asset must be visible but must not pop
 * an error toast); uncaught errors + unhandled rejections log at ERROR through the
 * single log-once funnel. Import-order-safe: no top-level side effects, safe to
 * call before render.
 */

/** The minimal logger surface this module calls (satisfied by utils/logger.ts). */
interface LoggerLike {
  warn(module: string, message: string, payload?: unknown): void;
  error(module: string, message: string, payload?: unknown): void;
}

type ChunkErrorHandler = (error: unknown) => boolean;

/** Minimal window surface this module touches — the injectable seam for tests. */
export interface GlobalErrorWindowLike {
  addEventListener(
    type: string,
    listener: (event: unknown) => void,
    options?: boolean | { capture?: boolean },
  ): void;
  __errorGuardHandlersInstalled?: boolean;
}

export interface SetupGlobalErrorHandlersOptions {
  /** Optional chunk handler: returns true if it consumed a chunk-load failure. */
  handleChunkError?: ChunkErrorHandler;
  /** Test seam — defaults to the real `window`. */
  win?: GlobalErrorWindowLike;
}

let chunkErrorHandler: ChunkErrorHandler | null = null;

/** Register the optional chunk-load handler; pass null/undefined to clear it. */
export function setChunkErrorHandler(fn: ChunkErrorHandler | null | undefined): void {
  chunkErrorHandler = typeof fn === 'function' ? fn : null;
}

/**
 * Register the global error listeners: capture-phase resource errors, window
 * 'error' (uncaught JS), and 'unhandledrejection'. Safe to call before render.
 * Calling more than once is a no-op after the first successful install (guarded
 * via a window flag, with a module-level fallback).
 */
export function setupGlobalErrorHandlers(
  logger: LoggerLike,
  options: SetupGlobalErrorHandlersOptions = {},
): void {
  if (typeof options.handleChunkError === 'function') {
    setChunkErrorHandler(options.handleChunkError);
  }

  const win: GlobalErrorWindowLike | undefined =
    options.win ??
    (typeof window !== 'undefined' ? (window as unknown as GlobalErrorWindowLike) : undefined);

  if (!win || typeof win.addEventListener !== 'function') {
    // No window to attach to (SSR / non-browser). A later browser-side call can
    // still use any chunk handler registered above.
    return;
  }

  // Idempotency: a window flag so duplicate module instances (bundler re-imports)
  // sharing one window still register the listeners only once.
  if (win.__errorGuardHandlersInstalled === true) return;
  win.__errorGuardHandlersInstalled = true;

  // Run the wired chunk handler, if any. Never throws — a broken handler must not
  // swallow the original error, so it is recorded and we fall back to logging.
  const tryHandleChunkError = (error: unknown): boolean => {
    if (typeof chunkErrorHandler !== 'function') return false;
    try {
      return chunkErrorHandler(error) === true;
    } catch (handlerError) {
      logger.warn('globalErrorHandler', 'chunkErrorHandler threw; falling back to normal logging', handlerError);
      return false;
    }
  };

  // --- Resource load failures (script / link / img), CAPTURE phase (no bubble) ---
  win.addEventListener(
    'error',
    (event: unknown) => {
      const e = event as {
        target?: { tagName?: string; src?: string; href?: string } | null;
        preventDefault?: () => void;
      };
      const target = e.target;
      // A real uncaught JS error has target === window; the bubble-phase listener owns it.
      if (!target || (target as unknown) === (win as unknown)) return;
      const tag = target.tagName;
      if (tag !== 'SCRIPT' && tag !== 'LINK' && tag !== 'IMG') return;

      const url = target.src || target.href || '';
      // Resource error events carry no `message`; the chunk detector matches on
      // message text, so build a pseudo-error for it.
      const pseudoError = new Error(`Failed to load resource: ${url}`);
      if (tryHandleChunkError(pseudoError)) {
        e.preventDefault?.();
        return;
      }

      // A NON-chunk resource failure (stylesheet / image / non-chunk script) must
      // still be recorded — WARN, not ERROR, so a missing asset does not pop a toast.
      logger.warn('globalErrorHandler', 'Resource failed to load', { url, tag });
    },
    true,
  );

  // --- Unhandled promise rejections ---
  win.addEventListener('unhandledrejection', (event: unknown) => {
    const e = event as { reason?: unknown; preventDefault?: () => void };
    const reason = e.reason;
    if (tryHandleChunkError(reason)) {
      e.preventDefault?.();
      return;
    }
    logger.error('UnhandledPromiseRejection', 'Global error caught', reason);
  });

  // --- Uncaught errors (bubble phase) ---
  win.addEventListener('error', (event: unknown) => {
    const e = event as { error?: unknown; message?: string; preventDefault?: () => void };
    const error = e.error;
    if (tryHandleChunkError(error)) {
      e.preventDefault?.();
      return;
    }
    logger.error('UncaughtError', 'Global error caught', error);
  });
}
