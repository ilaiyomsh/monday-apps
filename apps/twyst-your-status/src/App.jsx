import React, { Suspense, lazy, useEffect } from 'react';
import { useMondayContext } from './hooks/useMondayContext';
import OnClickDialog from './components/OnClickDialog/OnClickDialog';
import LoadingState from './components/shared/LoadingState';
import ErrorState from './components/shared/ErrorState';
import { dismissBootLoader } from './utils/bootLoader';

// Settings surfaces open rarely; keep them off the picker's critical path.
const SettingsLauncher = lazy(() => import('./components/ColumnSettings/SettingsLauncher'));
const ColumnSettings = lazy(() => import('./components/ColumnSettings/ColumnSettings'));
// Its own iframe, reached only after a label with required fields is picked.
const RequiredFieldsModal = lazy(() => import('./components/OnClickDialog/RequiredFieldsModal'));

/**
 * Resolve the active surface from the URL pathname.
 * Feature URLs in monday: …/picker (on-click Dialog Design, cell-attached),
 * …/settings (tiny shell), …/settings-full (settings overlay),
 * …/required-fields (the fill form, opened as a sized modal from the picker —
 * the picker's own dialog is fixed at 200×250 and cannot hold a grid).
 */
export function resolveAppRoute(pathname = window.location.pathname) {
  const normalized = String(pathname || '').replace(/\/+$/, '') || '/';
  if (normalized.endsWith('/picker') || normalized === '/picker') return 'picker';
  if (normalized.endsWith('/settings-full') || normalized === '/settings-full') return 'settings-full';
  if (normalized.endsWith('/settings') || normalized === '/settings') return 'settings';
  if (normalized.endsWith('/required-fields') || normalized === '/required-fields') return 'required-fields';
  return null;
}

function App() {
  const { context, loading, error } = useMondayContext();
  const route = resolveAppRoute();

  // The boot overlay (index.html) is monday's dialog spinner continued. TWO routes
  // keep it past THIS phase and hand it to the component that owns the release once
  // it has data — the picker (OnClickDialog) and the required-fields modal, which is
  // its own iframe and therefore serves this same index.html and paints the same
  // spinner. Every other route drops it at once. An error releases it too: a failure
  // must not sit behind a spinner.
  const overlayHeldByRoute = (route === 'picker' || route === 'required-fields') && !error;
  useEffect(() => {
    if (!overlayHeldByRoute) dismissBootLoader();
  }, [overlayHeldByRoute]);

  if (loading) {
    // Under the overlay: render nothing rather than a second loader. A loader of
    // our own here is exactly the visible jump this replaced.
    if (overlayHeldByRoute) return null;
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
      {route === 'required-fields' && (
        // No fallback loader: the boot overlay is still up and RequiredFieldsModal
        // takes it down once it has data.
        <Suspense fallback={null}>
          <RequiredFieldsModal context={context} />
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
