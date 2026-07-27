import React, { Suspense, lazy } from 'react';
import { useMondayContext } from './hooks/useMondayContext';
import OnClickDialog from './components/OnClickDialog/OnClickDialog';
import LoadingState from './components/shared/LoadingState';
import ErrorState from './components/shared/ErrorState';

// Settings opens rarely; keep it off the picker's critical path.
const ColumnSettings = lazy(() => import('./components/ColumnSettings/ColumnSettings'));

/**
 * Resolve the active surface from the URL pathname.
 * Feature URLs in monday are configured as …/picker and …/settings.
 */
export function resolveAppRoute(pathname = window.location.pathname) {
  const normalized = String(pathname || '').replace(/\/+$/, '') || '/';
  if (normalized.endsWith('/picker') || normalized === '/picker') return 'picker';
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
    <div className={`app-shell ${themeClass}`} dir={dir}>
      {route === 'picker' && <OnClickDialog context={context} />}
      {route === 'settings' && (
        <Suspense fallback={<LoadingState message="טוען הגדרות…" />}>
          <ColumnSettings context={context} />
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
