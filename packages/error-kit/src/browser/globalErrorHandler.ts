/**
 * globalErrorHandler.ts — global error capture funnelled into an app-local logger.
 *
 * Adopts team-people-column's semantics (the correct ones): a CAPTURE-PHASE window
 * 'error' listener for resource-load failures (script/link/img — these do NOT bubble,
 * so only capture sees them), an idempotency guard (a window flag with a module-level
 * fallback for non-browser/test), and an optional lazyRetry-style chunk-error seam.
 *
 * The logger is INJECTED (error-kit ships no logger). Resource failures log at WARN
 * (a missing asset should not pop an error toast but must be visible with url+tag);
 * uncaught errors and unhandled rejections log at ERROR through the single log-once
 * funnel. Import-order-safe: no top-level side effects, safe to call before render.
 */
import type { Logger } from '../types';

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
  /** Optional lazyRetry-style chunk handler: returns true if it consumed a chunk-load failure. */
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
 * Register the global error listeners: capture-phase resource errors, window 'error'
 * (uncaught JS), and 'unhandledrejection'. Safe to call before render. Calling more than
 * once is a no-op after the first successful install (guarded via a window flag, with a
 * module-level fallback).
 */
export function setupGlobalErrorHandlers(
  logger: Logger,
  options: SetupGlobalErrorHandlersOptions = {},
): void {
  if (typeof options.handleChunkError === 'function') {
    setChunkErrorHandler(options.handleChunkError);
  }

  const win: GlobalErrorWindowLike | undefined =
    options.win ?? (typeof window !== 'undefined' ? (window as unknown as GlobalErrorWindowLike) : undefined);

  if (!win || typeof win.addEventListener !== 'function') {
    // No window to attach to (SSR / non-browser). The chunk handler may still have been
    // registered above so a later browser-side call can use it.
    return;
  }

  // Idempotency: a window flag so duplicate module instances (bundler re-imports) that
  // share one window still register the listeners only once.
  if (win.__errorGuardHandlersInstalled === true) return;
  win.__errorGuardHandlersInstalled = true;

  /**
   * Best-effort textual description of a non-Error value. Never throws: a circular
   * structure or a hostile `toJSON`/`toString` is RECORDED (never swallowed) and returns
   * '' so the caller falls back to its stated message. Only `typeof` is logged — passing
   * the offending value on would hand the same hostile object to the logger.
   */
  const describeValue = (value: unknown): string => {
    try {
      if (typeof value === 'object' && value !== null) {
        const json = JSON.stringify(value);
        if (typeof json === 'string' && json !== '' && json !== '{}') return json;
      }
      return String(value);
    } catch (describeError) {
      logger.warn(
        'globalErrorHandler',
        'could not describe a non-Error value; using the fallback message',
        { valueType: typeof value, reason: describeError },
      );
      return '';
    }
  };

  /**
   * Normalize an arbitrary thrown/rejected value into a real Error (audit finding 2).
   *
   * The sink reads `err_name` / `err_msg` / `stack` off `record.error` only when it is an
   * object carrying those fields, so a string reason shipped NOTHING and `err_name` fell
   * back to the generic logger message — a record that costs an Axiom write and answers no
   * question. A rejection reason can be any value, and `event.error` is null for
   * cross-origin script failures, so normalization is what makes those reports readable.
   *
   * A real Error is returned as the SAME INSTANCE: the log-once funnel brands the instance
   * (`__loggedId`), so cloning it here would defeat deduplication.
   */
  const toError = (value: unknown, fallbackMessage: string): Error => {
    if (value instanceof Error) return value;
    const described = value === null || value === undefined ? '' : describeValue(value);
    const error = new Error(described === '' ? fallbackMessage : described);
    // Carry a non-Error's own `name` so err_name still groups by something meaningful
    // (e.g. a DOMException-shaped 'QuotaExceededError') instead of a flat 'Error'.
    const name =
      typeof value === 'object' && value !== null ? (value as { name?: unknown }).name : undefined;
    if (typeof name === 'string' && name !== '') error.name = name;
    return error;
  };

  // Run the wired chunk handler, if any. Never throws — a broken handler must not swallow
  // the original error, so it is recorded and we fall back to normal logging.
  const tryHandleChunkError = (error: unknown): boolean => {
    if (typeof chunkErrorHandler !== 'function') return false;
    try {
      return chunkErrorHandler(error) === true;
    } catch (handlerError) {
      logger.warn('globalErrorHandler', 'chunkErrorHandler threw; falling back to normal logging', handlerError);
      return false;
    }
  };

  // --- Resource load failures (script / link / img), CAPTURE phase (they do NOT bubble) ---
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
      // Resource error events carry no `message`; the chunk detector matches on message
      // text, so build a pseudo-error for it. The tag is folded into the message so a
      // failed stylesheet stays distinguishable from a failed script.
      const pseudoError = new Error(`Failed to load resource: ${tag} ${url}`);
      if (tryHandleChunkError(pseudoError)) {
        e.preventDefault?.();
        return;
      }

      // A NON-chunk resource failure (stylesheet / image / non-chunk script) must still be
      // recorded — WARN, not ERROR, so a missing asset does not pop an error toast.
      //
      // The pseudo-error is the PAYLOAD, not a `{ url, tag }` object (audit finding 1):
      // a plain object lands in record.data, which the sink deliberately never copies
      // (privacy) and which is not on the transport allowlist either — so the one fact
      // that makes this actionable, WHICH asset failed, could never reach Axiom. As an
      // Error it rides `err_msg`, an allowlisted field that scrubMessage redacts and caps.
      logger.warn('globalErrorHandler', 'Resource failed to load', pseudoError);
    },
    true,
  );

  // --- Unhandled promise rejections ---
  win.addEventListener('unhandledrejection', (event: unknown) => {
    const e = event as { reason?: unknown; preventDefault?: () => void };
    // Normalized BEFORE the chunk check: the detector matches on message TEXT, which a
    // string or plain-object rejection reason does not have — so a chunk-load failure
    // rejected with a bare string used to slip past the detector as well.
    const reason = toError(e.reason, 'Unhandled promise rejection with no reason');
    if (tryHandleChunkError(reason)) {
      e.preventDefault?.();
      return;
    }
    logger.error('UnhandledPromiseRejection', 'Global error caught', reason);
  });

  // --- Uncaught errors (bubble phase) ---
  win.addEventListener('error', (event: unknown) => {
    const e = event as { error?: unknown; message?: string; preventDefault?: () => void };
    // `event.error` is null for a cross-origin script failure — the browser withholds the
    // Error and `event.message` ("Script error.") is the only content on offer. Reading it
    // is the difference between a report with content and an empty one.
    const error = toError(
      e.error,
      typeof e.message === 'string' && e.message !== ''
        ? e.message
        : 'Uncaught error with no error object',
    );
    if (tryHandleChunkError(error)) {
      e.preventDefault?.();
      return;
    }
    logger.error('UncaughtError', 'Global error caught', error);
  });
}
