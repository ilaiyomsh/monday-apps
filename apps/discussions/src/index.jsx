import '@vibe/core/tokens'; // @vibe/core design tokens — must load before our CSS
import './styles/fonts.css'; // self-hosted monday brand fonts (Figtree + Noto Sans Hebrew)
import './index.css';
import './init'; // window.global polyfill (some deps expect it)
import './i18n'; // initialise i18next before any component uses useTranslation
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from '@generated/App.jsx';
import { MondayProvider } from './contexts/MondayContext.jsx';
import { SettingsProvider } from './contexts/SettingsContext.jsx';
import { TemplatesProvider } from './contexts/TemplatesContext.jsx';
import { ColumnWidthsProvider } from './contexts/ColumnWidthsContext.jsx';
import { ColumnOrderProvider } from './contexts/ColumnOrderContext.jsx';
import { SettingsGate } from './components/SettingsGate';
import { ErrorBoundary } from './components/ErrorBoundary';
import { setupGlobalErrorHandlers } from './utils/globalErrorHandler';
import { attachAxiomSink } from '@mapps/error-kit/browser';
import logger from './utils/logger.js';
import { makeAxiomLogger } from './utils/axiomLoggerAdapter.js';
import { getVersionLabel } from './utils/versionLabel.js';

// Layer 5: window.onerror / unhandledrejection -> logger, BEFORE React mounts.
setupGlobalErrorHandlers();

// Axiom telemetry sink — now the SHARED @mapps/error-kit/browser transport + sink
// (the vendored axiomErrorSink/axiomBrowserTransport copies were retired). Registered on
// the same logger.addSink fan-out useUiErrorSink uses, BEFORE createRoot so the ring-buffer
// replay ships any import-time ERROR/WARN records. Idempotent (globalThis guard inside the
// sink) so StrictMode's double-invoke never double-registers; inert unless PROD + VITE_AXIOM_*
// baked in. log-once (correlationId) already withholds duplicates from every sink. The logger
// is wrapped by makeAxiomLogger so record.domainKind still lands on the shipped `kind` field
// (error-kit reads the discriminator off record.kind, this app carries it as domainKind).
const AXIOM_APP = import.meta.env.VITE_AXIOM_APP;
const AXIOM_DATASET = import.meta.env.VITE_AXIOM_DATASET;
const AXIOM_TOKEN = import.meta.env.VITE_AXIOM_TOKEN;
attachAxiomSink(makeAxiomLogger(logger), {
  app: AXIOM_APP,
  dataset: AXIOM_DATASET,
  token: AXIOM_TOKEN,
  // Version layer: semver + build SHA (e.g. "2.2.0+a1b2c3f") for exact-commit traceability.
  appVersion:
    (typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0') +
    (typeof __BUILD_SHA__ !== 'undefined' ? `+${__BUILD_SHA__.slice(0, 7)}` : ''),
  environment: import.meta.env.VITE_AXIOM_ENV ?? 'production',
  // Preserve the vendored activation gate EXACTLY, including VITE_AXIOM_APP (error-kit's
  // default gate checks only dataset+token, so the app-slug requirement is passed explicitly).
  active:
    import.meta.env.PROD === true &&
    Boolean(AXIOM_DATASET) &&
    Boolean(AXIOM_TOKEN) &&
    Boolean(AXIOM_APP),
});

// The single sanctioned console call in the app: a version banner printed once
// at boot so support can read the running version off any user's console. Not
// an error — it must NOT enter the logger funnel (no toast, no Axiom).
// eslint-disable-next-line no-console
console.info('[discussions] ' + getVersionLabel());

// SettingsGate (round337 — extracted to components/SettingsGate so it is
// testable; this file runs createRoot at import time, which no test can mount)
// renders the app only after settings have been loaded & published to the SDK
// store. Its branching: loading → spinner; load FAILED → NetworkErrorScreen
// with retry; nothing stored → first-run SetupWizard; configured → the app.

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <MondayProvider>
        <SettingsProvider>
          <SettingsGate>
            <TemplatesProvider>
              <ColumnWidthsProvider>
                <ColumnOrderProvider>
                  <App />
                </ColumnOrderProvider>
              </ColumnWidthsProvider>
            </TemplatesProvider>
          </SettingsGate>
        </SettingsProvider>
      </MondayProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
