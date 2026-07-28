import React from 'react';

/*
 * A CSS spinner rather than Vibe's <Loader>, for the same reason as ErrorState:
 * this is on the eager path (App's Suspense fallbacks), and Icon → react-inlinesvg
 * came with it into the picker's critical chunk — where this component is never
 * rendered at all, because the picker continues monday's own boot spinner instead
 * (see MANIFEST.md, "Boot loading state").
 *
 * The markup is the same shape as the hand-transcribed Vibe Loader in index.html
 * (viewBox 0 0 50 50, one r=20 stroke-width=5 circle, 1s rotate + 1s dash), so the
 * two loaders in this app look identical. Styles live in index.css as
 * `.twyst-loading-state`; if Vibe's Loader changes, both copies need re-syncing.
 */

function LoadingState({ message = 'Loading...' }) {
  return (
    <div className="twyst-loading-state flex flex-col items-center justify-center py-12">
      <svg viewBox="0 0 50 50" role="alert" aria-label={message}>
        <circle cx="25" cy="25" r="20" fill="none" strokeWidth="5" />
      </svg>
      <p className="twyst-loading-state-message">{message}</p>
    </div>
  );
}

export default LoadingState;
