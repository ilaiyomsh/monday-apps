import React, { Suspense, lazy } from 'react';
import { useMondayContext } from './hooks/useMondayContext';
import PickerLauncher from './components/OnClickDialog/PickerLauncher';
import LoadingState from './components/shared/LoadingState';
import ErrorState from './components/shared/ErrorState';

// Settings / full picker surfaces open as nested modals; keep them off the
// column-dialog critical path.
const SettingsLauncher = lazy(() => import('./components/ColumnSettings/SettingsLauncher'));
const ColumnSettings = lazy(() => import('./components/ColumnSettings/ColumnSettings'));
const OnClickDialog = lazy(() => import('./components/OnClickDialog/OnClickDialog'));

/**
 * Resolve the active surface from the URL pathname.
 * Feature URLs in monday: …/picker (column dialog shell → stable modal),
 * …/picker-full (status list inside openAppFeatureModal),
 * …/settings (tiny shell), …/settings-full (settings overlay).
 */
export function resolveAppRoute(pathname = window.location.pathname) {
  const normalized = String(pathname || '').replace(/\/+$/, '') || '/';
  if (normalized.endsWith('/picker-full') || normalized === '/picker-full') return 'picker-full';
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
  const isPickerSurface = route === 'picker' || route === 'picker-full';

  return (
    <div className={`app-shell${isPickerSurface ? ' is-picker' : ''} ${themeClass}`} dir={dir}>
      {route === 'picker' && <PickerLauncher context={context} />}
      {route === 'picker-full' && (
        <Suspense fallback={<LoadingState message="טוען את הסטטוסים…" />}>
          <OnClickDialog context={context} variant="overlay" />
        </Suspense>
      )}
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
