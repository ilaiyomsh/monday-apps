import React from 'react';
import { useMondayContext } from './hooks/useMondayContext';
import OnClickDialog from './components/OnClickDialog/OnClickDialog';
import ColumnSettings from './components/ColumnSettings/ColumnSettings';
import LoadingState from './components/shared/LoadingState';
import ErrorState from './components/shared/ErrorState';
import WorkflowConfigurator from './components/WorkflowConfigurator/WorkflowConfigurator';
import WorkflowPanel from './components/WorkflowPanel/WorkflowPanel';

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
  const requestedView = new URLSearchParams(window.location.search).get('view');
  const isWorkflowBoardView = requestedView === 'board';
  const isWorkflowItemView = requestedView === 'item';

  return (
    <div className={`app-shell ${themeClass}`} dir={dir}>
      {placement === 'columnPickers' && (
        <OnClickDialog context={context} />
      )}
      {placement === 'settings' && (
        <ColumnSettings context={context} />
      )}
      {isWorkflowBoardView && <WorkflowConfigurator context={context} />}
      {isWorkflowItemView && <WorkflowPanel context={context} />}
      {!placement && !isWorkflowBoardView && !isWorkflowItemView && (
        <div className="placement-message">
          <p>
            יש לפתוח את האפליקציה מתוך תא בעמודת Status.
          </p>
        </div>
      )}
    </div>
  );
}

export default App;

