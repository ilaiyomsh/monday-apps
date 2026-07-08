import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { setupGlobalErrorHandlers } from './errors/globalErrorHandler';
import type { Logger } from './logger';

/** monday-sdk-js expects a Node-style `global`. Call before creating the SDK. */
export function polyfillGlobal(): void {
  (window as unknown as { global?: Window }).global ??= window;
}

export interface BootstrapOptions {
  logger: Logger;
  children: ReactNode;
  rootElementId?: string;
  strict?: boolean;
}

/**
 * Standardized startup (the Axis app shell): polyfill → global error handlers →
 * render. i18n is initialized per app (resources differ) before calling this.
 */
export function bootstrapApp({ logger, children, rootElementId = 'root', strict = true }: BootstrapOptions): void {
  polyfillGlobal();
  setupGlobalErrorHandlers(logger);
  const el = document.getElementById(rootElementId);
  if (!el) throw new Error(`bootstrapApp: #${rootElementId} not found`);
  createRoot(el).render(strict ? <StrictMode>{children}</StrictMode> : <>{children}</>);
}
