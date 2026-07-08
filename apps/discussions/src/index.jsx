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

// Layer 5: window.onerror / unhandledrejection -> logger, BEFORE React mounts.
setupGlobalErrorHandlers();

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
