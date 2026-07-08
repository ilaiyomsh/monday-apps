import React, { useCallback } from 'react';
import { X } from 'lucide-react';
import { useStableT } from '../../i18n/useStableT';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import styles from './ConfirmDialog.module.css';

export default function ConfirmDialog({
    isOpen,
    onClose,
    onConfirm,
    onCancel,
    title,
    message,
    confirmText,
    cancelText,
    confirmButtonStyle = "primary" // 'primary' | 'danger'
}) {
    const t = useStableT();
    const handleEscape = useCallback(() => {
        (onCancel || onClose)();
    }, [onCancel, onClose]);

    const dialogRef = useFocusTrap(isOpen, handleEscape);

    if (!isOpen) return null;

    const resolvedTitle       = title       ?? t('common.confirm.title');
    const resolvedMessage     = message     ?? t('common.confirm.message');
    const resolvedConfirmText = confirmText ?? t('common.confirm.confirmText');
    const resolvedCancelText  = cancelText  ?? t('common.confirm.cancelText');

    return (
        <div className={styles.overlay}>
            <div className={styles.dialog} ref={dialogRef} role="dialog" aria-modal="true" tabIndex={-1}>
                <div className={styles.header}>
                    <h3>{resolvedTitle}</h3>
                    <button className={styles.closeButton} onClick={onCancel || onClose}>
                        <X size={20} />
                    </button>
                </div>
                <div className={styles.content}>
                    <p>{resolvedMessage}</p>
                </div>
                <div className={styles.footer}>
                    <button
                        className={`${styles.button} ${styles.cancelBtn}`}
                        onClick={onCancel || onClose}
                    >
                        {resolvedCancelText}
                    </button>
                    <button
                        className={`${styles.button} ${confirmButtonStyle === 'danger' ? styles.dangerBtn : styles.confirmBtn}`}
                        onClick={onConfirm}
                    >
                        {resolvedConfirmText}
                    </button>
                </div>
            </div>
        </div>
    );
}
