import React, { useEffect, useState, useRef, Suspense } from "react";
import "./App.css";
import mondaySdk from "monday-sdk-js";
import MondayCalendar from "./MondayCalendar";
import { SettingsProvider, useSettings } from "./contexts/SettingsContext";
import { MondayProvider, useMondayContext } from "./contexts/MondayContext";
import { ProjectColorsProvider } from "./contexts/ProjectColorsContext";
import { useSettingsValidation } from "./components/SettingsDialog/useSettingsValidation";
import { useLanguageSync } from './hooks/useLanguageSync';
import { useLocale } from './hooks/useLocale';
import { usePrefetchColumnOptions } from './hooks/usePrefetchColumnOptions';
import logger from './utils/logger';
import lazyRetry from './utils/lazyRetry';
import ErrorBoundary from "./components/ErrorBoundary/ErrorBoundary";
import { useToast } from "./hooks/useToast";
import { useUiErrorSink } from "./hooks/useUiErrorSink";
import { ToastContainer } from "./components/Toast";
import ErrorDetailsModal from "./components/ErrorDetailsModal/ErrorDetailsModal";
import StopwatchLoader from "./components/StopwatchLoader";
import loaderStyles from "./components/StopwatchLoader/StopwatchLoader.module.css";
import NetworkErrorScreen from "./components/NetworkErrorScreen";
const SettingsWizard = React.lazy(lazyRetry(() => import("./components/SettingsWizard"), 'SettingsWizard'));
const SettingsDialog = React.lazy(lazyRetry(() => import("./components/SettingsDialog/SettingsDialog"), 'SettingsDialog'));
const ProjectColorsDialog = React.lazy(lazyRetry(() => import("./components/ProjectColorsDialog/ProjectColorsDialog"), 'ProjectColorsDialog'));
const Dashboard = React.lazy(lazyRetry(() => import("./components/Dashboard/Dashboard"), 'Dashboard'));

const monday = mondaySdk();
// DEV-only: expose for console diagnostics. Stripped from production builds.
if (import.meta.env.DEV && typeof window !== 'undefined') {
    window.__monday = monday;
}

// זמן תחילת טעינת האפליקציה - משותף בין App loader ל-MondayCalendar loader
const appLoadStart = Date.now();

// רכיב פנימי שמשתמש ב-Settings Context
const AppContent = () => {
  const { customSettings, isLoading, loadError, reloadSettings } = useSettings();
  const { context, isMobile } = useMondayContext();
  const { isValid: settingsAreValid } = useSettingsValidation(customSettings, context);

  // אינקרמנט 8 — סנכרון שפה ל-i18next מ-settings/context.
  useLanguageSync();
  usePrefetchColumnOptions(monday);

  // dir/lang ל-document נגזרים מ-i18n.language דרך useLocale — שורש האמת היחיד.
  // useMondayContext.dir מתעלם מ-languageOverride וגורם לפיצול בין טקסט (he) לכיוון (ltr).
  const { dir, language } = useLocale();
  useEffect(() => {
    document.documentElement.setAttribute('dir', dir);
    document.documentElement.setAttribute('lang', language);
    return () => {
      // לא מחזירים לערכים קודמים בהדפ-עוטף — האפליקציה חיה לאורך כל הסשן.
    };
  }, [dir, language]);

  // החלת theme (light/dark/auto) על documentElement.
  // במצב auto: עוקבים אחרי ה-theme של Monday (context.theme), עם fallback ל-prefers-color-scheme
  // של ה-OS אם Monday לא חושף theme. תמיד מחילים ערך מוחלט ('light'/'dark') כדי שכל ה-CSS
  // יעבוד דרך סלקטור אחד בלבד ([data-theme="dark"]).
  const themeMode = customSettings?.themeMode ?? 'auto';
  const mondayTheme = context?.theme; // 'light' | 'dark' | 'black' | 'hacker_theme' | undefined
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      // במובייל תמיד light — מתעלם מההגדרה ומה-OS
      if (isMobile) {
        document.documentElement.setAttribute('data-theme', 'light');
        return;
      }
      let resolved;
      if (themeMode === 'auto') {
        if (mondayTheme === 'light') {
          resolved = 'light';
        } else if (mondayTheme === 'dark' || mondayTheme === 'black' || mondayTheme === 'hacker_theme') {
          resolved = 'dark';
        } else {
          resolved = mq.matches ? 'dark' : 'light';
        }
      } else {
        resolved = themeMode;
      }
      document.documentElement.setAttribute('data-theme', resolved);
    };
    apply();
    if (themeMode === 'auto' && !mondayTheme) {
      mq.addEventListener('change', apply);
      return () => mq.removeEventListener('change', apply);
    }
  }, [themeMode, mondayTheme, isMobile]);
  const isFirstInstall = !customSettings?.lastModifiedAt;
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isProjectColorsOpen, setIsProjectColorsOpen] = useState(false);
  const [currentView, setCurrentView] = useState('calendar');
  const initStep2Logged = useRef(false);
  const autoOpenedRef = useRef(false);
  // Toast management — המופע הגלובלי: ה-UI sink מציג דרכו את כל טוסטי-השגיאה
  const {
    toasts,
    showToast,
    removeToast,
    errorDetailsModal,
    openErrorDetailsModal,
    closeErrorDetailsModal
  } = useToast();

  // UI Error Sink — נתיב ההצגה היחיד לשגיאות: כל רשומת ERROR ב-logger → טוסט
  // (כולל replay של שגיאות init מה-ring buffer). ראו docs/ui-sink-plan.md.
  useUiErrorSink({ showToast });

  // Init Step 2 — AppContent נטען
  useEffect(() => {
    if (!initStep2Logged.current) {
      initStep2Logged.current = true;
      logger.initDone(2, 'AppContent mounted');
    }
  }, []);

  // התקנה ראשונה — פתיחת אשף ההגדרות אוטומטית פעם אחת בלבד (לא במובייל)
  useEffect(() => {
    if (isLoading) return;
    if (autoOpenedRef.current) return;
    if (isFirstInstall && !isMobile) {
      autoOpenedRef.current = true;
      setIsSettingsOpen(true);
    }
  }, [isLoading, isFirstInstall, isMobile]);

  // משטח התצוגה הגלובלי של ה-UI sink — חייב להתרנדר בכל ענפי ה-return
  // (loadError / isLoading / רגיל), אחרת טוסטים שנכנסו ל-state בזמן טעינה/שגיאת
  // טעינה לא יוצגו ולא ייסגרו אוטומטית (הטיימר חי בתוך רכיב ה-Toast המרונדר).
  const globalErrorSurface = (
    <>
      {/* Toast Notifications - גלובלי */}
      <ToastContainer
        toasts={toasts}
        onRemove={removeToast}
        onShowErrorDetails={openErrorDetailsModal}
      />

      {/* Error Details Modal - גלובלי */}
      <ErrorDetailsModal
        isOpen={!!errorDetailsModal}
        onClose={closeErrorDetailsModal}
        errorDetails={errorDetailsModal}
      />
    </>
  );

  if (loadError) {
    return (
      <>
        {globalErrorSurface}
        <NetworkErrorScreen onRetry={reloadSettings} isLoading={isLoading} />
      </>
    );
  }

  if (isLoading) {
    return (
      <>
        {globalErrorSurface}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100dvh', background: 'var(--color-bg-primary)', gap: '16px' }}>
          <StopwatchLoader size={80} />
          <p className={loaderStyles.brandText}>Powered by Twyst</p>
        </div>
      </>
    );
  }

  return (
    <div className="App">
      {globalErrorSurface}

      {/* הגדרות: אשף מינימלי בהתקנה ראשונה, דיאלוג קלאסי לעריכה לאחר מכן */}
      {isSettingsOpen && !isMobile && (
        <ErrorBoundary onError={openErrorDetailsModal}>
          <Suspense fallback={null}>
            {isFirstInstall ? (
              <SettingsWizard
                monday={monday}
                context={context}
                mode="firstInstall"
                onClose={() => setIsSettingsOpen(false)}
              />
            ) : (
              <SettingsDialog
                monday={monday}
                context={context}
                onClose={() => setIsSettingsOpen(false)}
              />
            )}
          </Suspense>
        </ErrorBoundary>
      )}
      {isProjectColorsOpen && (
        <Suspense fallback={null}>
          <ProjectColorsDialog
            isOpen={isProjectColorsOpen}
            onClose={() => setIsProjectColorsOpen(false)}
          />
        </Suspense>
      )}

      {isSettingsOpen && isMobile && (
        <ErrorBoundary onError={openErrorDetailsModal}>
          <Suspense fallback={null}>
            <SettingsDialog
              monday={monday}
              context={context}
              onClose={() => setIsSettingsOpen(false)}
            />
          </Suspense>
        </ErrorBoundary>
      )}

      {/* רכיב הלוח / דשבורד */}
      <main className="app-main">
        {currentView === 'calendar' ? (
          <ErrorBoundary onError={openErrorDetailsModal}>
            <MondayCalendar
              monday={monday}
              onOpenSettings={() => setIsSettingsOpen(true)}
              onOpenProjectColors={() => setIsProjectColorsOpen(true)}
              onSwitchToDashboard={() => setCurrentView('dashboard')}
              appLoadStart={appLoadStart}
              hasIncompleteSettings={!settingsAreValid}
              isFirstInstall={isFirstInstall}
            />
          </ErrorBoundary>
        ) : (
          <ErrorBoundary onError={openErrorDetailsModal}>
            <Suspense fallback={null}>
              <Dashboard
                monday={monday}
                onSwitchToCalendar={() => setCurrentView('calendar')}
                onOpenSettings={() => setIsSettingsOpen(true)}
                isOwner={true}
                hasIncompleteSettings={!settingsAreValid}
              />
            </Suspense>
          </ErrorBoundary>
        )}
      </main>
    </div>
  );
};

// רכיב App הראשי שעוטף הכל ב-MondayProvider.
// גבול שורש ErrorBoundary *מעל* שלושת ה-providers — ה-ErrorBoundary self-contained
// (תלוי רק ב-i18next/logger/errorHandler), ולכן זריקת render ב-provider/בטעינה מוקדמת
// נתפסת ונרשמת במקום להלבין מסך. הגבולות הפנימיים (פר-רכיב, ב-AppContent) שומרים על
// onError={openErrorDetailsModal} כדי לפתוח את מודל פרטי השגיאה כשה-context זמין.
const App = () => {
  return (
    <ErrorBoundary>
      <MondayProvider monday={monday}>
        <SettingsProvider monday={monday}>
          <ProjectColorsProvider>
            <AppContent />
          </ProjectColorsProvider>
        </SettingsProvider>
      </MondayProvider>
    </ErrorBoundary>
  );
};

export default App;

