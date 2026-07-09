import React from 'react';
import { Toast as VibeToast } from '@vibe/core';
import { useTranslation } from 'react-i18next';
import styles from './Toast.module.css';

// useToast types -> @vibe/core Toast types
const TYPE_MAP = {
  success: 'positive',
  error: 'negative',
  warning: 'warning',
  info: 'normal',
  loading: 'normal',
};

/**
 * Renders the useToast() queue as @vibe/core Toasts. Error toasts that carry
 * `errorDetails` get a "details" action (opens ErrorDetailsModal); toasts with
 * an `onRetry` get a "retry" action.
 */
export function ToastContainer({ toasts = [], onRemove, onShowErrorDetails }) {
  const { t } = useTranslation();

  return (
    <div className={styles.container}>
      {toasts.map((toast) => {
        const actions = [];
        if (toast.errorDetails && onShowErrorDetails) {
          actions.push({
            type: 'button',
            content: t('errorBoundary.details'),
            onClick: () => onShowErrorDetails(toast.errorDetails),
          });
        }
        if (toast.onRetry) {
          actions.push({
            type: 'button',
            content: t('common.retry'),
            onClick: () => {
              toast.onRetry();
              onRemove?.(toast.id);
            },
          });
        }
        // NOTE: a generic `action` (e.g. "בטל" / undo) is intentionally NOT
        // pushed into Vibe's `actions` (those render at the message's trailing
        // edge). It is rendered inside the toast content to the LEFT of the
        // message (see the .body flex row below).

        // A loading toast stays open until removed programmatically (duration 0
        // → no auto-hide, not user-closeable). It shows an hourglass (⏳) we
        // render ourselves — see below — instead of the default Vibe spinner.
        const isLoading = toast.type === 'loading';
        // Drop the status icon (✓ / !) on action-feedback AND loading toasts —
        // the message text + color (and the hourglass for loading) already
        // convey the state. Errors keep their icon (a clear failure signal that
        // pairs with the "details" action).
        const hideIcon = toast.type !== 'error';
        return (
          <VibeToast
            key={toast.id}
            open
            type={TYPE_MAP[toast.type] || 'normal'}
            hideIcon={hideIcon}
            closeable={!isLoading}
            autoHideDuration={isLoading || toast.duration === 0 ? undefined : (toast.duration ?? 6000)}
            onClose={() => onRemove?.(toast.id)}
            actions={actions.length ? actions : undefined}
          >
            {/* dir="rtl" + plaintext bidi so a Hebrew message with leading
                numbers or a trailing ellipsis ("3 משימות…", "יוצר משימה…")
                keeps correct RTL order. Loading toasts get a leading ⏳. */}
            <span className={styles.body}>
              {/* Undo (or any generic action) sits to the LEFT of the message —
                  the LTR flex row places this first child on the left, the
                  message on the right. Running it also dismisses the toast. */}
              {toast.action && (
                <button
                  type="button"
                  className={styles.undoBtn}
                  onClick={() => { toast.action.onClick?.(); onRemove?.(toast.id); }}
                >
                  {toast.action.label}
                </button>
              )}
              <span dir="rtl" style={{ display: 'inline-block', unicodeBidi: 'plaintext' }}>
                {isLoading && <span aria-hidden="true" style={{ marginInlineEnd: 6 }}>⏳</span>}
                {toast.message}
              </span>
            </span>
          </VibeToast>
        );
      })}
    </div>
  );
}

export default ToastContainer;
