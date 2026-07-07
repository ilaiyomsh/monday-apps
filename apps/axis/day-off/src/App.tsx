import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorBoundary, MondayProvider, useMondayContext, useErrorHandler } from '@axis/app-core';
import { ErrorDetailsModal } from './components/ErrorDetailsModal';
import { DayOffView } from './components/DayOffView';
import { DayOffDataProvider } from './contexts/DayOffDataProvider';
import { monday, logger, SettingsProvider, useSettings } from './core';

function AppContent() {
  const { context } = useMondayContext();
  const { settings } = useSettings();
  const { i18n } = useTranslation();
  const { error, clearError } = useErrorHandler(logger);

  // Settings own the language now (default Hebrew); monday's user language is ignored.
  const language = settings.languageOverride ?? 'he';
  const dir = language === 'he' ? 'rtl' : 'ltr';

  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = dir;
    if (i18n.language !== language) void i18n.changeLanguage(language);
  }, [language, dir, i18n]);

  // Theme follows the monday platform (light/dark). tokens.css defines [data-theme="dark"].
  useEffect(() => {
    const theme = context?.theme === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', theme);
  }, [context?.theme]);

  return (
    <>
      <DayOffDataProvider>
        <DayOffView />
      </DayOffDataProvider>
      <ErrorDetailsModal error={error} onDismiss={clearError} />
    </>
  );
}

export default function App() {
  return (
    <ErrorBoundary logger={logger}>
      <MondayProvider monday={monday} logger={logger}>
        <SettingsProvider monday={monday} logger={logger}>
          <AppContent />
        </SettingsProvider>
      </MondayProvider>
    </ErrorBoundary>
  );
}
