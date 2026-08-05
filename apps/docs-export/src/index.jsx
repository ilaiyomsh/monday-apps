/**
 * React 19 entry point — wired for error-guard / the shared Axiom standard.
 *
 * Ordering is LOAD-BEARING and enforced in CI by scripts/error-wiring-audit.mjs
 * (both wiring calls must appear textually BEFORE `createRoot(`):
 *
 *   1. setupGlobalErrorHandlers(logger) — installs window.onerror +
 *      unhandledrejection + capture-phase resource errors and routes them to the
 *      logger, so a throw during the very first render (or from a module
 *      side-effect) is already captured.
 *   2. attachAxiomSink(...) — synchronous, before render, because the sink
 *      replays the logger's ring buffer on attach; anything emitted during
 *      import-time would otherwise be lost.
 *   3. <AppErrorBoundary scope="root"> wraps the whole tree and renders the
 *      Hebrew fallback (chunk-load vs render crash).
 *
 * Async / event-handler errors are not render errors: they are covered by layer 1
 * and by routing catches through useAppErrorFunnel().showBoundary(err), or through
 * the toast path (useUiErrorSink).
 *
 * See docs/ERROR-AXIOM-STANDARD.md.
 */

import '@vibe/core/tokens';
import './index.css';
import './i18n';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { setupGlobalErrorHandlers, attachAxiomSink } from '@mapps/error-kit/browser';
import logger from './utils/logger';
import { toAxiomLogger } from './utils/axiomLogger';
import { getVersionLabel } from './utils/versionLabel';
import { AppErrorBoundary } from './components/ErrorBoundary/AppErrorBoundary';
import { MondayProvider } from './contexts/MondayContext';
import App from './App';

// 1. Global handlers FIRST — before any React render can throw.
setupGlobalErrorHandlers(logger);

console.info('[docs-export] ' + getVersionLabel());

// 2. Remote error monitoring — synchronous, before render (ring-buffer replay
//    contract). Fail-soft: with no token baked in, the gate is inert and nothing
//    ships, rather than the build breaking. The ingest token is the only secret;
//    dataset/app are CI literals (see the deploy workflow's Build step).
//    The package's default active-gate does not require an `app` slug — this app
//    does (VITE_AXIOM_APP discriminates it inside the shared `app-errors`
//    dataset), so `active` is computed explicitly here.
const AXIOM_DATASET = import.meta.env.VITE_AXIOM_DATASET;
const AXIOM_TOKEN = import.meta.env.VITE_AXIOM_TOKEN;
const AXIOM_APP = import.meta.env.VITE_AXIOM_APP;
attachAxiomSink(toAxiomLogger(logger), {
  app: AXIOM_APP,
  dataset: AXIOM_DATASET,
  token: AXIOM_TOKEN,
  active:
    import.meta.env.PROD === true &&
    Boolean(AXIOM_DATASET) &&
    Boolean(AXIOM_TOKEN) &&
    Boolean(AXIOM_APP),
  appVersion:
    (typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0') +
    (typeof __BUILD_SHA__ !== 'undefined' ? `+${__BUILD_SHA__.slice(0, 7)}` : ''),
  environment: import.meta.env.VITE_AXIOM_ENV ?? 'production',
});

// 3. Root boundary ABOVE the app (its onError logs every render throw).
const root = createRoot(document.getElementById('root'));

root.render(
  <React.StrictMode>
    <AppErrorBoundary scope="root">
      <MondayProvider>
        <App />
      </MondayProvider>
    </AppErrorBoundary>
  </React.StrictMode>
);
