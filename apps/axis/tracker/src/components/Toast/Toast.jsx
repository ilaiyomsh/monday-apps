import React, { useEffect, useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import styles from './Toast.module.css';
import ErrorToast from '../ErrorToast/ErrorToast';
import logger from '../../utils/logger';

/**
 * Toast notification component
 * מציג הודעות למשתמש (הצלחה, שגיאה, אזהרה, מידע)
 */
const Toast = ({ message, type = 'info', duration = 5000, errorDetails = null, onRetry = null, onClose, onShowDetails }) => {
    const { t } = useTranslation();
    const [isExiting, setIsExiting] = useState(false);
    // ref ל-timer של אנימציית היציאה (300ms) כדי לנקות אותו ב-unmount ולמנוע דליפה
    const exitTimerRef = useRef(null);

    const startExit = useCallback(() => {
        if (isExiting) return;
        setIsExiting(true);
        exitTimerRef.current = setTimeout(() => {
            try {
                onClose?.();
            } catch (error) {
                logger.error('Toast', 'onClose handler failed', error);
            }
        }, 300);
    }, [isExiting, onClose]);

    useEffect(() => {
        if (duration > 0) {
            const timer = setTimeout(startExit, duration);
            return () => clearTimeout(timer);
        }
    }, [duration, startExit]);

    // ניקוי ה-timer של אנימציית היציאה כשהקומפוננטה מתפרקת
    useEffect(() => {
        return () => {
            if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
        };
    }, []);

    // אם זו שגיאה עם errorDetails, נציג ErrorToast
    if (type === 'error' && errorDetails) {
        return (
            <ErrorToast
                message={message}
                errorDetails={errorDetails}
                onShowDetails={onShowDetails}
                onRetry={onRetry}
                duration={duration}
                onClose={startExit}
            />
        );
    }

    // אחרת, נציג Toast רגיל
    const icons = {
        success: '✓',
        error: '✕',
        warning: '⚠',
        info: 'ℹ'
    };

    return (
        <div className={`${styles.toast} ${styles[type]} ${isExiting ? styles.exiting : ''}`}>
            <span className={styles.icon}>{icons[type] || icons.info}</span>
            <span className={styles.message}>{message}</span>
            <button
                className={styles.closeButton}
                onClick={startExit}
                aria-label={t('common.close')}
            >
                ×
            </button>
        </div>
    );
};

/**
 * Toast Container - מנהל רשימת הודעות
 */
export const ToastContainer = ({ toasts, onRemove, onShowErrorDetails }) => {
    // Portal ל-document.body כדי לעקוף ancestor transforms ש"גוזרים" את ה-position:fixed
    // ויוצרים גלישה מהקצה במובייל.
    if (typeof document === 'undefined') return null;
    return createPortal(
        <div className={styles.toastContainer} aria-live="polite" aria-relevant="additions removals">
            {toasts.map((toast) => (
                <Toast
                    key={toast.id}
                    message={toast.message}
                    type={toast.type}
                    duration={toast.duration}
                    errorDetails={toast.errorDetails || null}
                    onRetry={toast.onRetry || null}
                    onClose={() => onRemove(toast.id)}
                    onShowDetails={toast.errorDetails && onShowErrorDetails ? () => onShowErrorDetails(toast.errorDetails) : null}
                />
            ))}
        </div>,
        document.body
    );
};

export default Toast;

