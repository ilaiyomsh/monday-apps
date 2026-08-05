
/*
 * No @vibe/core here, deliberately. This component sits on the EAGER path (App
 * renders it for a context error, the picker for a settings error), and a single
 * Vibe import pulls Button → Tooltip → Dialog → popper into the picker's critical
 * chunk — ~47 KB gzip re-parsed on every iframe boot, for a screen that is almost
 * never rendered.
 *
 * Nor is it lazy-loaded: this is the screen shown when the network failed, so a
 * fallback that needs a network fetch to appear fails exactly when it is needed.
 * A plain <button> with Vibe's CSS custom properties is the house pattern for
 * this — cf. ErrorBoundary/AppErrorBoundary.jsx and axis/tracker's
 * NetworkErrorScreen.jsx. The tokens come from `@import "@vibe/core/tokens"` in
 * index.css, which stays.
 *
 * The colours are tokens rather than Tailwind's text-red-500/text-gray-700, which
 * are fixed light-mode greys — this screen was unreadable in monday's dark themes.
 */

const iconStyle = {
  width: '48px',
  height: '48px',
  color: 'var(--negative-color, #d83a52)',
  marginBottom: '16px',
};

const messageStyle = {
  margin: '0 0 16px',
  fontSize: '14px',
  textAlign: 'center',
  color: 'var(--secondary-text-color, #676879)',
};

const buttonStyle = {
  padding: '8px 24px',
  fontSize: '14px',
  borderRadius: '4px',
  border: '1px solid var(--ui-border-color, #c3c6d4)',
  background: 'var(--primary-background-color, #ffffff)',
  color: 'var(--primary-text-color, #323338)',
  cursor: 'pointer',
};

function ErrorState({ message = 'An error occurred', onRetry }) {
  return (
    <div className="flex flex-col items-center justify-center py-12">
      <svg
        style={iconStyle}
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
        />
      </svg>
      <p style={messageStyle}>{message}</p>
      {onRetry && (
        <button type="button" style={buttonStyle} onClick={onRetry}>
          Try Again
        </button>
      )}
    </div>
  );
}

export default ErrorState;
