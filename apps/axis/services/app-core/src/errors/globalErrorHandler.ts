import type { Logger } from '../logger';

/**
 * Global error capture (standard #6, Tracker model): window error +
 * unhandledrejection funnel into the logger (the UI sink turns each into one toast).
 * Call once at bootstrap, before render.
 */
export function setupGlobalErrorHandlers(logger: Logger): void {
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason as { message?: string } | undefined;
    logger.error('unhandledrejection', String(reason?.message ?? event.reason), event.reason);
  });

  window.addEventListener('error', (event) => {
    // resource-load failures (script/link/img) arrive with a target, no error object
    const target = event.target as { tagName?: string; src?: string; href?: string } | null;
    if (target && target !== (window as unknown) && /^(SCRIPT|LINK|IMG)$/.test(target.tagName ?? '')) {
      logger.error('resource-load', `failed to load ${target.src ?? target.href ?? 'asset'}`);
      return;
    }
    logger.error('window.onerror', event.message, event.error);
  });
}
