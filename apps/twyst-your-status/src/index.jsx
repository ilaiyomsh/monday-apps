/**
 * React 18 entry point ג€” wired for error-guard.
 *
 * Ordering is load-bearing (React 18 has no createRoot error options ג€” those are
 * a React 19 addition ג€” so two layers carry the whole error surface here):
 *   1. setupGlobalErrorHandlers() runs BEFORE createRoot, so a throw during the
 *      very first render (or from a module side-effect) is already captured. It
 *      installs window.onerror + unhandledrejection + capture-phase resource
 *      errors and routes them to the logger.
 *   2. <AppErrorBoundary scope="root"> wraps the whole tree ג€” on React 18 its
 *      onError is the ONLY place render throws get logged, and it renders the
 *      Hebrew fallback screen (chunk-load vs render).
 *
 * Async / event-handler errors are not render errors: they are covered by layer 1
 * and by routing catches through useAppErrorFunnel().showBoundary(err).
 *
 * To surface caught errors to the user as a toast, register useUiErrorSink
 * (src/hooks/useUiErrorSink.js) once near the root, passing your app's showToast.
 *
 * When you upgrade to React 19, move to the createRoot({ onUncaughtError,
 * onCaughtError }) pattern to also capture render errors at the root.
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import { setupGlobalErrorHandlers } from './utils/globalErrorHandler';
import { attachAxiomSink } from './utils/axiomErrorSink';
import logger from './utils/logger';
import { VERSION_LABEL } from './utils/versionLabel';
import { AppErrorBoundary } from './components/ErrorBoundary/AppErrorBoundary';
import { dismissBootLoader } from './utils/bootLoader';
import App from './App';
import './index.css';

// 1. Global handlers FIRST ג€” before any React render can throw.
setupGlobalErrorHandlers();

// 1b. Remote error monitoring ג€” synchronous, before render (ring-buffer replay
//     contract). Structurally inert unless VITE_AXIOM_DATASET/TOKEN/APP are baked
//     into a production build (.env.production.local ג€” git-ignored). Wiring +
//     one-time Axiom setup: error-guard references/remote-monitoring.md. Once the
//     monday context loads, also call setAxiomContext({accountId, userId, boardId,
//     instanceId}) (useMondayContext is the natural place).
attachAxiomSink();
logger.health('client_started', { version: VERSION_LABEL });

// 1c. Boot-overlay backstop. The overlay (index.html) is opaque and is normally
//     taken down by App / OnClickDialog / the error boundary. This covers the
//     paths none of them can reach — a module that throws before React mounts, a
//     hook that never settles — so the worst case is a slow dialog, never a
//     permanently spinning one. Cheap: one timer, cleared implicitly by removal.
const BOOT_OVERLAY_MAX_MS = 15000;
setTimeout(() => {
  const stillUp = document.getElementById('twyst-boot-loader') !== null;
  if (!stillUp) return;
  logger.error('bootLoader', 'boot overlay still up after timeout — forcing dismissal', {
    afterMs: BOOT_OVERLAY_MAX_MS,
  });
  dismissBootLoader();
}, BOOT_OVERLAY_MAX_MS);

// 2. React 18 createRoot takes no error options ג€” the boundary + global handlers
//    are the entire safety net.
const root = createRoot(document.getElementById('root'));

// 3. Root boundary ABOVE the app (its onError logs every render throw).
root.render(
  <React.StrictMode>
    <AppErrorBoundary scope="root">
      <App />
    </AppErrorBoundary>
  </React.StrictMode>
);

