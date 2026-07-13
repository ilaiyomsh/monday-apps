import React, { useCallback, Suspense, lazy } from 'react';
import { useMondayContext } from './hooks/useMondayContext';
import { useUiErrorSink } from './hooks/useUiErrorSink';
import mondayService from './services/mondayService';
import OnClickDialog from './components/OnClickDialog/OnClickDialog';
import LoadingState from './components/shared/LoadingState';
import ErrorState from './components/shared/ErrorState';

// The settings pane is opened rarely (column setup) while the on-click picker
// opens on EVERY cell click — and the dialog iframe reloads from scratch each
// time. Splitting settings out keeps its code (RadioButton/Checkbox/Popover +
// board-columns logic) off the picker's critical path.
const ColumnSettings = lazy(() => import('./components/ColumnSettings/ColumnSettings'));

// Modules that already display their own errors inline (ErrorState /
// validation UI) — a toast on top would be a duplicate, lower-value signal
// for the same failure, so the UI error sink skips records from them.
const INLINE_ERROR_MODULES = new Set([
  'OnClickDialog',
  'ColumnSettings',
  'useColumnSettings',
  'useAllowedUsers',
  // context-load failure renders the inline ErrorState (App error branch) —
  // a toast on top would double-display the same failure.
  'useMondayContext',
]);

/**
 * Column View App
 *
 * Context structure from Monday SDK:
 * {
 *   placement: "columnPickers" | "settings",  // Determines which view to show
 *   boardId: number,
 *   columnId: string,
 *   itemId: number,              // Only present in columnPickers (onclick)
 *   selectedItemIds: number[],   // Only present in columnPickers (onclick)
 *   columnType: string,
 *   theme: "light" | "dark",
 *   user: {
 *     id: string,
 *     currentLanguage: string,   // e.g., "en", "he"
 *     isAdmin: boolean,
 *     ...
 *   },
 *   account: { id: string },
 *   app: { id: number, clientId: string },
 *   ...
 * }
 */

function App() {
  const { context, loading, error } = useMondayContext();

  // Single UI error-toast sink for the whole app (error-guard). Registered
  // unconditionally (before any early return) — hooks must run every render.
  const showToast = useCallback((message, type, _autoCloseMs, details) => {
    if (details?.module && INLINE_ERROR_MODULES.has(details.module)) return;
    mondayService.showNotice(message, type);
  }, []);
  useUiErrorSink({ showToast });

  if (loading) {
    return <LoadingState />;
  }

  if (error) {
    return <ErrorState message={error} />;
  }

  const themeClass = context?.theme === 'dark' ? 'dark-app-theme' : 'light-app-theme';
  const placement = context?.placement;
  const isRTL = context?.user?.currentLanguage === 'he';
  const dir = isRTL ? 'rtl' : 'ltr';

  return (
    <div className={`min-h-screen p-4 ${themeClass}`} dir={dir}>
      {placement === 'columnPickers' && (
        <OnClickDialog context={context} />
      )}
      {placement === 'settings' && (
        <Suspense fallback={<LoadingState message="טוען הגדרות..." />}>
          <ColumnSettings context={context} />
        </Suspense>
      )}
      {!placement && (
        <div className="text-center py-8">
          <p style={{ color: 'var(--secondary-text-color, #676879)' }}>
            יש לפתוח רכיב זה מתוך עמודה ב-monday.com.
          </p>
        </div>
      )}
    </div>
  );
}

export default App;
