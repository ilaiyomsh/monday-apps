/**
 * React 18 entry point — wired for error-guard.
 *
 * Ordering is load-bearing (React 18 has no createRoot error options — those are
 * a React 19 addition — so two layers carry the whole error surface here):
 *   1. setupGlobalErrorHandlers() runs BEFORE createRoot, so a throw during the
 *      very first render (or from a module side-effect) is already captured. It
 *      installs window.onerror + unhandledrejection + capture-phase resource
 *      errors and routes them to the logger.
 *   2. <AppErrorBoundary scope="root"> wraps the whole tree — on React 18 its
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
import { setupGlobalErrorHandlers, attachAxiomSink } from '@mapps/error-kit/browser';
import logger from './utils/logger';
import { toAxiomLogger } from './utils/axiomLogger';
import { getVersionLabel } from './utils/versionLabel.js';
import { AppErrorBoundary } from './components/ErrorBoundary/AppErrorBoundary';
import App from './App';
import './index.css';

// 1. Global handlers FIRST — before any React render can throw. error-kit's
//    setupGlobalErrorHandlers takes the app logger explicitly (no module-local
//    logger import inside the package).
setupGlobalErrorHandlers(logger);

// Version layer (docs/monday-cicd-spec.md): one build-identity breadcrumb per
// load — see error-guard/references/known-issues.md FP-4 for why this stays a
// raw console.info (logger.info would be muted outside debug mode).
console.info('[team-people-column] ' + getVersionLabel());

// 1b. Remote error monitoring — synchronous, before render (ring-buffer replay
//     contract). Structurally inert unless VITE_AXIOM_DATASET/TOKEN/APP are baked
//     into a production build (.env.production.local — git-ignored). Wiring +
//     one-time Axiom setup: error-guard references/remote-monitoring.md. Once the
//     monday context loads, also call setAxiomContext({accountId, userId, boardId,
//     instanceId}) (useMondayContext is the natural place).
//
//     The package's default active-gate does not require an `app` slug — this
//     app's original gate did (VITE_AXIOM_APP), so `active` is computed
//     explicitly here to preserve that requirement.
const AXIOM_DATASET = import.meta.env.VITE_AXIOM_DATASET;
const AXIOM_TOKEN = import.meta.env.VITE_AXIOM_TOKEN;
const AXIOM_APP = import.meta.env.VITE_AXIOM_APP;
attachAxiomSink(toAxiomLogger(logger), {
  app: AXIOM_APP,
  dataset: AXIOM_DATASET,
  token: AXIOM_TOKEN,
  active: import.meta.env.PROD === true && Boolean(AXIOM_DATASET) && Boolean(AXIOM_TOKEN) && Boolean(AXIOM_APP),
  // Version layer: semver + build SHA (e.g. "2.2.0+a1b2c3f") for exact-commit
  // traceability of remote error records.
  appVersion:
    (typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0') +
    (typeof __BUILD_SHA__ !== 'undefined' ? `+${__BUILD_SHA__.slice(0, 7)}` : ''),
  environment: import.meta.env.VITE_AXIOM_ENV ?? 'production',
});

// 1c. Dev-mock harness bootstrap — ONLY when running `pnpm dev:mock`
//     (VITE_MONDAY_MOCK truthy). Must run BEFORE React mounts: it seeds the
//     dev-harness stub's context/storage/API fixtures that useMondayContext
//     and the rest of the app read on first render. See src/dev/mockBoot.js
//     for why this can't be driven by process.env in the browser.
async function boot() {
  if (import.meta.env.VITE_MONDAY_MOCK) {
    const { bootMock } = await import('./dev/mockBoot.js');
    bootMock();
  }

  // 2. React 18 createRoot takes no error options — the boundary + global
  //    handlers are the entire safety net.
  const root = createRoot(document.getElementById('root'));

  // 3. Root boundary ABOVE the app (its onError logs every render throw).
  root.render(
    <React.StrictMode>
      <AppErrorBoundary scope="root">
        <App />
      </AppErrorBoundary>
    </React.StrictMode>
  );
}

// boot() is async: a rejection BEFORE root.render (e.g. the dynamic import of
// dev/mockBoot.js failing) would otherwise leave a white screen with only an
// unhandledrejection record. Log it and write a minimal static Hebrew fallback
// into #root so a pre-mount failure still has a display path.
boot().catch((err) => {
  // Same canonical shape the removed local handleGlobalError() used to produce
  // (module 'boot', message 'Global error caught') — logger.error stamps the
  // log-once id so nothing downstream re-logs this same error object.
  logger.error('boot', 'Global error caught', err);
  const rootEl = document.getElementById('root');
  if (rootEl) {
    rootEl.innerHTML =
      '<div role="alert" dir="rtl" style="padding:20px;text-align:center">' +
      '<h2>טעינת האפליקציה נכשלה</h2>' +
      '<p>אירעה שגיאה בעת טעינת הרכיב. רעננו את הדף כדי לנסות שוב.</p>' +
      '</div>';
  }
});
