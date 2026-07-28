import '@vibe/core/tokens'; // @vibe/core design tokens — must load before our CSS
import './styles/fonts.css'; // self-hosted monday brand fonts (Figtree + Noto Sans Hebrew)
import './index.css';
import './init'; // window.global polyfill (some deps expect it)
import './i18n'; // initialise i18next before any component uses useTranslation
import React from 'react';
import { createRoot } from 'react-dom/client';
import { Flex, Loader, Heading, Text } from '@vibe/core';
import App from '@generated/App.jsx';
import { MondayProvider } from './contexts/MondayContext.jsx';
import { SettingsProvider, useSettings } from './contexts/SettingsContext.jsx';
import { TemplatesProvider } from './contexts/TemplatesContext.jsx';
import { ColumnWidthsProvider } from './contexts/ColumnWidthsContext.jsx';
import { ColumnOrderProvider } from './contexts/ColumnOrderContext.jsx';
import { SettingsModal } from './components/SettingsModal';
import { SetupWizard } from './components/SetupWizard';
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

console.info('[discussions] ' + getVersionLabel());

// Renders the app only after settings (boards/columns mapping) have been
// loaded & published to the SDK store — so every SDK call has its mapping.
// If nothing is stored yet (isConfigured=false), force the Settings UI so the
// user maps boards/columns BEFORE any app content / SDK call runs.
function SettingsGate({ children }) {
  const { isLoading, isConfigured } = useSettings();
  // First-run: offer the auto-provision wizard; "manual" falls back to the
  // existing forced SettingsModal (mapping existing boards/columns).
  const [manual, setManual] = React.useState(false);

  if (isLoading) {
    return (
      <Flex justify="center" align="center" style={{ height: '100svh' }}>
        <Loader size={32} />
      </Flex>
    );
  }

  if (!isConfigured) {
    if (!manual) {
      return <SetupWizard onManual={() => setManual(true)} />;
    }
    return (
      <div dir="ltr">
        <Flex direction="column" align="center" gap={12} style={{ padding: 24, textAlign: 'center' }}>
          <Heading type="h3">הגדרת האפליקציה</Heading>
          <Text type="text1" color="secondary">
            לפני השימוש יש למפות את הלוחות והעמודות
          </Text>
          <Text type="text2" color="secondary">
            בחרו את לוח הדיונים, לוח המשימות ולוח הנושאים, ואת העמודות התואמות בכל לוח, ולחצו שמור.
          </Text>
        </Flex>
        {/* Forced open, no onClose — the user cannot dismiss until configured. */}
        <SettingsModal isOpen onClose={() => {}} />
      </div>
    );
  }

  return children;
}

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
