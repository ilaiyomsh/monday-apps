import React from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Settings, X } from 'lucide-react';
import styles from './SettingsValidationDialog.module.css';

export default function SettingsValidationDialog({
    isOpen,
    onClose,
    onOpenSettings,
    validationResult,
    isOwner = false
}) {
    const { t } = useTranslation();
    if (!isOpen || !validationResult) return null;

    return (
        <div className={styles.overlay}>
            <div className={styles.dialog}>
                <div className={styles.header}>
                    <div className={styles.titleGroup}>
                        <AlertTriangle size={24} className={styles.warningIcon} />
                        <h3>{t('settingsValidation.title')}</h3>
                    </div>
                    <button className={styles.closeButton} onClick={onClose} aria-label={t('common.close')}>
                        <X size={20} />
                    </button>
                </div>

                <div className={styles.content}>
                    <p className={styles.message}>
                        {isOwner
                            ? t('settingsValidation.messageOwner')
                            : t('settingsValidation.messageViewer')}
                    </p>
                </div>

                <div className={styles.footer}>
                    <button
                        className={`${styles.button} ${styles.cancelBtn}`}
                        onClick={onClose}
                    >
                        {isOwner ? t('settingsValidation.dismissOwner') : t('common.close')}
                    </button>
                    {isOwner && (
                        <button
                            className={`${styles.button} ${styles.settingsBtn}`}
                            onClick={() => {
                                onClose();
                                onOpenSettings();
                            }}
                        >
                            <Settings size={18} />
                            {t('settingsValidation.openSettings')}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
