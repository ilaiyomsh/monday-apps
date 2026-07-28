/**
 * globalErrorHandler.ts — FACADE SHIM.
 *
 * Global error capture now lives in `@mapps/error-kit` (packages/error-kit). This file
 * is a thin re-export so `bootstrapApp` and the app-core barrel keep the same path +
 * public API. `setupGlobalErrorHandlers(logger)` is call-compatible with the old
 * one-arg form (the `options` param is optional); consumers inherit error-kit's fixes —
 * a CAPTURE-phase resource-error listener (script/link/img failures do not bubble),
 * resource failures logged at WARN, an idempotency guard, and an optional chunk-error seam.
 */
export {
  setupGlobalErrorHandlers,
  setChunkErrorHandler,
  type SetupGlobalErrorHandlersOptions,
  type GlobalErrorWindowLike,
} from '@mapps/error-kit/browser';
