import React, { Suspense, lazy } from 'react';
import { useMondayContext } from './hooks/useMondayContext';
import OnClickDialog from './components/OnClickDialog/OnClickDialog';
import LoadingState from './components/shared/LoadingState';
import ErrorState from './components/shared/ErrorState';

// Settings surfaces open rarely; keep them off the picker's critical path.
const SettingsLauncher = lazy(() => import('./components/ColumnSettings/SettingsLauncher'));
const ColumnSettings = lazy(() => import('./components/ColumnSettings/ColumnSettings'));

/**
 * Resolve the active surface from the URL pathname.
 * Feature URLs in monday: …/picker (on-click Dialog Design, cell-attached),
 * …/settings (tiny shell), …/settings-full (settings overlay).
 */
export function resolveAppRoute(pathname = window.location.pathname) {
  const normalized = String(pathname || '').replace(/\/+$/, '') || '/';
  if (normalized.endsWith('/picker') || normalized === '/picker') return 'picker';
  if (normalized.endsWith('/settings-full') || normalized === '/settings-full') return 'settings-full';
  if (normalized.endsWith('/settings') || normalized === '/settings') return 'settings';
  return null;
}

function App() {
  const { context, loading, error } = useMondayContext();
  const route = resolveAppRoute();

  if (loading) {
    return <LoadingState />;
  }

  if (error) {
    return <ErrorState message={error} />;
  }

  const themeClass = context?.theme === 'dark' ? 'dark-app-theme' : 'light-app-theme';
  const isRTL = context?.user?.currentLanguage === 'he';
  const dir = isRTL ? 'rtl' : 'ltr';

  return (
    <div className={`app-shell${route === 'picker' ? ' is-picker' : ''} ${themeClass}`} dir={dir}>
      {route === 'picker' && <OnClickDialog context={context} />}
      {route === 'settings' && (
        <Suspense fallback={<LoadingState message="טוען…" />}>
          <SettingsLauncher />
        </Suspense>
      )}
      {route === 'settings-full' && (
        <Suspense fallback={<LoadingState message="טוען הגדרות…" />}>
          <ColumnSettings context={context} variant="overlay" />
        </Suspense>
      )}
      {route === null && (
        <div className="placement-message">
          <p>
            פתחו את האפליקציה דרך
            {' '}
            <code>/picker</code>
            {' '}
            או
            {' '}
            <code>/settings</code>
            .
          </p>
        </div>
      )}
    </div>
  );
}

export default App;
