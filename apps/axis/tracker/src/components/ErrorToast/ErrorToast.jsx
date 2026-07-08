import React, { useState } from 'react';
import { useStableT } from '../../i18n/useStableT';
import logger from '../../utils/logger';
import styles from './ErrorToast.module.css';

/**
 * ErrorToast - רכיב Toast מותאם לשגיאות עם אפשרות להעתיק פרטים ולצפות בפרטים מלאים
 */
const ErrorToast = ({
    message,
    errorDetails,
    onShowDetails,
    onRetry,
    duration = 0, // 0 = לא נסגר אוטומטית
    onClose
}) => {
    const t = useStableT();
    const [copied, setCopied] = useState(false);

    const handleCopyDetails = async () => {
        if (!errorDetails) return;

        try {
            // המרת כל אובייקט השגיאה ל-JSON
            const errorJson = JSON.stringify(errorDetails, null, 2);
            await navigator.clipboard.writeText(errorJson);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (error) {
            logger.error('ErrorToast', 'Failed to copy error details', error);
        }
    };

    const handleShowDetails = () => {
        if (onShowDetails) {
            onShowDetails();
        }
    };

    return (
        <div className={styles.errorToast}>
            <span className={styles.message}>{message}</span>
            <div className={styles.actions}>
                <button
                    className={styles.actionButton}
                    onClick={handleCopyDetails}
                    aria-label={t('errors.toast.copyDetails')}
                    title={t('errors.toast.copyDetails')}
                >
                    {copied ? '✓' : '📋'}
                </button>
                {onRetry && (
                    <button
                        className={`${styles.actionButton} ${styles.retryButton}`}
                        onClick={() => { onClose?.(); onRetry(); }}
                        aria-label={t('errors.toast.retry')}
                        title={t('errors.toast.retry')}
                    >
                        ↻
                    </button>
                )}
                {onShowDetails && (
                    <button
                        className={styles.actionButton}
                        onClick={handleShowDetails}
                        aria-label={t('errors.toast.details')}
                        title={t('errors.toast.details')}
                    >
                        ℹ️
                    </button>
                )}
                <button
                    className={styles.closeButton}
                    onClick={onClose}
                    aria-label={t('errors.toast.close')}
                    title={t('errors.toast.close')}
                >
                    ×
                </button>
            </div>
            {copied && (
                <span className={styles.copiedIndicator}>{t('errors.toast.copied')}</span>
            )}
        </div>
    );
};

export default ErrorToast;

