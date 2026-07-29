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

const DEFAULT_DURATION_MS = 3000;

/**
 * Renders the useToast() queue as @vibe/core Toasts. Error toasts that carry
 * `errorDetails` get a "details" action that opens ErrorDetailsModal.
 */
export function ToastContainer({ toasts = [], onRemove, onShowErrorDetails }) {
  const { t } = useTranslation();

  return (
    <div className={styles.container}>
      {toasts.map((toast) => {
        const actions =
          toast.errorDetails && onShowErrorDetails
            ? [
                {
                  type: 'button',
                  content: t('common.details'),
                  onClick: () => onShowErrorDetails(toast.errorDetails),
                },
              ]
            : undefined;

        // A loading toast stays open until removed programmatically
        // (duration 0 → no auto-hide, not user-closeable).
        const isLoading = toast.type === 'loading';
        // Drop the status icon on everything but errors — the message text and
        // colour already convey the state; an error keeps its icon because it
        // pairs with the "details" action.
        const hideIcon = toast.type !== 'error';

        return (
          <VibeToast
            key={toast.id}
            open
            type={TYPE_MAP[toast.type] || 'normal'}
            hideIcon={hideIcon}
            closeable={!isLoading}
            autoHideDuration={
              isLoading || toast.duration === 0 ? undefined : (toast.duration ?? DEFAULT_DURATION_MS)
            }
            onClose={() => onRemove?.(toast.id)}
            actions={actions}
          >
            <span className={styles.body}>
              <span dir="rtl" style={{ display: 'inline-block', unicodeBidi: 'plaintext' }}>
                {isLoading && (
                  <span aria-hidden="true" style={{ marginInlineEnd: 6 }}>
                    ⏳
                  </span>
                )}
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
