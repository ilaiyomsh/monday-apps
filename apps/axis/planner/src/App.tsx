import React, { useState, useEffect, useCallback, lazy } from 'react';
import { useTranslation } from 'react-i18next';
import { GanttContent } from './components/Gantt/GanttContent';
import { GanttProvider } from './components/Gantt/GanttProvider';
import { SettingsProvider, useSettings } from './contexts/SettingsContext';
import { ActiveProjectsProvider } from './contexts/ActiveProjectsContext';
import { MondayContextProvider, useMondayContext } from './contexts/MondayContext';
import { FreeFallLoader } from './components/ui';
import { useLanguageSync } from './hooks/useLanguageSync';
import { useLocale } from './hooks/useLocale';
import { logger } from './utils/Logger';
import { useViewTracking } from './utils/viewTracking';
import { useUiErrorSink } from './hooks/useUiErrorSink';
import { LazyBoundary } from './components/ui/LazyBoundary';
import './App.css';

// Boot health (D5) fires exactly once per page load, at the app's init-done point.
let bootHealthSent = false;

// Lazy-load SettingsDialog - only loaded when needed
const SettingsDialog = lazy(() =>
  import('./components/Settings/SettingsDialog').then(m => ({ default: m.SettingsDialog }))
);

type ErrorVariant = 'generic' | 'network';

const ErrorScreen: React.FC<{
  message: string;
  onRetry: () => void;
  variant?: ErrorVariant;
}> = ({ message, onRetry, variant = 'generic' }) => {
  const { t } = useTranslation();
  const isNetwork = variant === 'network';
  const title = isNetwork ? t('app.error.network.title') : t('app.error.title');
  const description = isNetwork ? t('app.error.network.description') : message;

  return (
    <div className="w-full h-screen flex items-center justify-center bg-bg-app">
      <div className="flex flex-col items-center gap-4 text-center px-6">
        <div className="w-16 h-16 bg-danger-soft rounded-full flex items-center justify-center">
          {/* was: stroke="#dc2626" — unified to --color-danger-strong */}
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--color-danger-strong)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-text-primary">{title}</h2>
        <p className="text-text-muted max-w-md whitespace-pre-line">{description}</p>
        <div className="flex gap-3">
          {isNetwork && (
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-2 bg-accent text-white font-medium rounded-lg hover:bg-accent-hover transition-colors"
            >
              {t('app.error.network.refresh')}
            </button>
          )}
          <button
            onClick={onRetry}
            className={`px-6 py-2 font-medium rounded-lg transition-colors ${
              isNetwork
                ? 'bg-bg-surface text-text-secondary border border-border-default hover:bg-bg-hover'
                : 'bg-accent text-white hover:bg-accent-hover'
            }`}
          >
            {t('app.error.retry')}
          </button>
        </div>
        {/* Raw technical message intentionally hidden — kept available for
            console diagnostics only (see logger.error in useMondaySettings). */}
      </div>
    </div>
  );
};

const LoadingScreen: React.FC = () => (
  <div className="w-full h-screen flex items-center justify-center bg-bg-app">
    <div className="flex flex-col items-center gap-4">
      <FreeFallLoader size={80} />
      {/* Branding — not translated. */}
      <p className="text-text-muted font-medium">Powered by Twyst</p>
    </div>
  </div>
);

/** Renders once settings are loaded — handles configured vs unconfigured state */
const ConfiguredContent: React.FC = () => {
  const { t } = useTranslation();
  const { context, permissions } = useMondayContext();
  const { loading: settingsLoading, isConfigured, error: settingsError, errorKind: settingsErrorKind, refresh: refreshSettings } = useSettings();
  // Sync i18n language with settings.languageOverride / Monday context.
  // Lives here (rather than AppContent) so SettingsProvider is mounted.
  // Block first paint until language is resolved — otherwise English users
  // see a flash of Hebrew before useLanguageSync catches up.
  const { isResolved: languageResolved } = useLanguageSync();
  const [showSettings, setShowSettings] = useState(false);

  // Usage telemetry (D3): report the welcome (unconfigured) screen once per session — fires
  // only once settings+language resolve without error and the app is NOT configured. Passing ''
  // otherwise is ignored by the tracker, so navigating in/out never re-ships.
  const welcomeShown = !settingsLoading && languageResolved && !settingsError && !isConfigured;
  useViewTracking(logger, welcomeShown ? 'welcome' : '');

  // Auto-open settings if not configured and user has permissions
  useEffect(() => {
    if (!settingsLoading && !isConfigured && permissions?.canEditSettings) {
      setShowSettings(true);
    }
  }, [settingsLoading, isConfigured, permissions]);

  // [LOAD_FLOW] trace — fires once per state transition (from an effect, not the
  // render body), so it is no longer re-logged on every unrelated re-render.
  const loadReady = !settingsLoading && languageResolved;
  useEffect(() => {
    if (!loadReady) {
      logger.info('[LOAD_FLOW] [4/5] Waiting for settings + language...');
      return;
    }
    if (settingsError) {
      logger.error(`[LOAD_FLOW] [4/5] Settings error (kind=${settingsErrorKind ?? 'unknown'}) — showing error screen:`, settingsError);
      return;
    }
    logger.info(`[LOAD_FLOW] [4/5] Settings ready — isConfigured: ${isConfigured}`);
    logger.info(isConfigured
      ? '[LOAD_FLOW] [5/5] Mounting GanttProvider — app fully loaded'
      : '[LOAD_FLOW] [5/5] Not configured — showing welcome screen');
    // Boot health (D5): one-shot per page load, at the init-done point (settings + language
    // resolved). ms = time-to-ready since navigation start; ships as domainKind='health'.
    if (!bootHealthSent) {
      bootHealthSent = true;
      logger.health('boot_ok', {
        configured: isConfigured,
        ms: Math.round(typeof performance !== 'undefined' ? performance.now() : 0),
      });
    }
  }, [loadReady, settingsError, settingsErrorKind, isConfigured]);

  if (settingsLoading || !languageResolved) {
    return <LoadingScreen />;
  }

  if (settingsError) {
    return (
      <ErrorScreen
        message={settingsError}
        onRetry={refreshSettings}
        variant={settingsErrorKind === 'network' ? 'network' : 'generic'}
      />
    );
  }

  return (
    <div className="w-full h-screen p-[10px] flex items-center justify-center bg-bg-app" data-theme={context?.theme}>
      <div className="w-full max-w-[100%] h-full flex flex-col relative">
        {!isConfigured && (
          <div className="flex-1 flex flex-col items-center justify-center gap-6 bg-bg-surface rounded-[12px] shadow-sm p-12 text-center">
            <div className="w-20 h-20 bg-accent-bg-soft rounded-full flex items-center justify-center">
              {/* was: stroke="#2563eb" — unified to --color-accent-strong */}
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent-strong)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"></circle>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
              </svg>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-text-primary mb-2">{t('app.welcome.title')}</h1>
              <p className="text-text-muted max-w-md mx-auto">
                {t('app.welcome.description')}
              </p>
            </div>
            {permissions?.canEditSettings ? (
              <button
                onClick={() => setShowSettings(true)}
                className="px-6 py-3 bg-accent text-white font-bold rounded-[8px] hover:bg-accent-hover transition-colors shadow-lg"
              >
                {t('app.welcome.cta')}
              </button>
            ) : (
              <p className="text-warning-text font-medium">{t('app.welcome.noPermission')}</p>
            )}
          </div>
        )}

        {isConfigured && (
          <GanttProvider>
            <GanttContent />
          </GanttProvider>
        )}

        <LazyBoundary>
          <SettingsDialog
            isOpen={showSettings}
            onClose={() => setShowSettings(false)}
            boardId={context?.boardId}
          />
        </LazyBoundary>
      </div>
    </div>
  );
};

/** Orchestrates sequential loading: context first, then settings */
const AppContent: React.FC = () => {
  const { loading: contextLoading, error: contextError, refresh: refreshContext } = useMondayContext();
  const locale = useLocale();

  // Sync html/body dir + lang + Vibe's `monday-rtl` body class with the active
  // locale. Increment 10: when locale.dir flips to 'ltr' the class is dropped.
  // Split into two effects: this one runs on every locale flip without
  // touching unmount cleanup, so the document is never momentarily wrong
  // between dependency-change cycles.
  useEffect(() => {
    document.documentElement.dir = locale.dir;
    document.documentElement.lang = locale.language;
    document.body.dir = locale.dir;
    if (locale.isRtl) {
      document.body.classList.add('monday-rtl');
    } else {
      document.body.classList.remove('monday-rtl');
    }
  }, [locale.dir, locale.language, locale.isRtl]);

  // Unmount-only: restore Monday's default RTL so neighboring app shells in
  // the iframe aren't stranded in LTR after this app unmounts.
  useEffect(() => {
    return () => {
      document.documentElement.dir = 'rtl';
      document.body.dir = 'rtl';
      document.body.classList.add('monday-rtl');
    };
  }, []);

  // [LOAD_FLOW] context trace — once per transition, not on every render.
  useEffect(() => {
    if (contextLoading) return;
    if (contextError) {
      logger.error('[LOAD_FLOW] Context error — showing error screen:', contextError);
    } else {
      logger.info('[LOAD_FLOW] Context ready — mounting SettingsProvider (SDK guaranteed ready)');
    }
  }, [contextLoading, contextError]);

  // Phase 1: Loading context
  if (contextLoading) {
    return <LoadingScreen />;
  }

  // Phase 1: Context error
  if (contextError) {
    return <ErrorScreen message={contextError} onRetry={refreshContext} />;
  }

  // Phase 2: Context ready — mount SettingsProvider (SDK guaranteed ready)
  return (
    <SettingsProvider>
      <ActiveProjectsProvider>
        <ConfiguredContent />
      </ActiveProjectsProvider>
    </SettingsProvider>
  );
};

/**
 * Always-mounted app-shell error toaster. Registers the UI error sink (one caught ERROR =
 * one toast) and renders a single toast overlay for the app lifetime — so errors from any
 * layer surface to the user even outside the Gantt (which has its own local toast for its
 * direct actions). Render crashes are shown by the ErrorBoundary fallback, not here (the
 * sink skips module==='ErrorBoundary').
 */
const AppErrorToaster: React.FC = () => {
  const { t } = useTranslation();
  const [toast, setToast] = useState<string | null>(null);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const onError = useCallback(() => {
    // record.message is a stable English event id, not user copy — show a generic localized
    // message (one toast per ERROR record; log-once dedup already happens in logger.emit).
    setToast(t('app.error.title'));
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setToast(null), 5000);
  }, [t]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  useUiErrorSink({ onError });

  if (!toast) return null;
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999] flex items-center gap-2 px-5 py-2.5 rounded-lg shadow-xl text-sm font-medium bg-danger text-white">
      {toast}
    </div>
  );
};

function App() {
  return (
    <MondayContextProvider>
      <AppErrorToaster />
      <AppContent />
    </MondayContextProvider>
  );
}

export default App;
