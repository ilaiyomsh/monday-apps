import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import logger from '../../utils/logger';
import styles from './ErrorDetailsModal.module.css';

/**
 * ErrorDetailsModal - מודל להצגת פרטי שגיאה מלאים
 */
const ErrorDetailsModal = ({ isOpen, onClose, errorDetails }) => {
    const { t } = useTranslation();
    const [activeTab, setActiveTab] = useState('error');
    const [copied, setCopied] = useState(false);
    const [copiedQuery, setCopiedQuery] = useState(false);

    useEffect(() => {
        if (!isOpen) {
            setActiveTab('error');
            setCopied(false);
            setCopiedQuery(false);
        }
    }, [isOpen]);

    useEffect(() => {
        const handleEscape = (e) => {
            if (e.key === 'Escape' && isOpen) {
                onClose();
            }
        };
        document.addEventListener('keydown', handleEscape);
        return () => document.removeEventListener('keydown', handleEscape);
    }, [isOpen, onClose]);

    if (!isOpen || !errorDetails) return null;

    const handleCopyAll = async () => {
        try {
            const errorJson = JSON.stringify(errorDetails, null, 2);
            await navigator.clipboard.writeText(errorJson);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (error) {
            logger.error('ErrorDetailsModal', 'Failed to copy error details', error);
        }
    };

    const handleCopyQuery = async () => {
        if (!errorDetails.apiRequest) return;
        
        try {
            let queryText = errorDetails.apiRequest.query || '';
            if (errorDetails.apiRequest.variables) {
                queryText += '\n\nVariables:\n' + JSON.stringify(errorDetails.apiRequest.variables, null, 2);
            }
            await navigator.clipboard.writeText(queryText);
            setCopiedQuery(true);
            setTimeout(() => setCopiedQuery(false), 2000);
        } catch (error) {
            logger.error('ErrorDetailsModal', 'Failed to copy query', error);
        }
    };

    const formatJson = (obj) => {
        return JSON.stringify(obj, null, 2);
    };

    return (
        <div className={styles.overlay} onClick={onClose}>
            <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
                <div className={styles.header}>
                    <h3>{t('errorDetailsModal.title')}</h3>
                    <button className={styles.closeButton} onClick={onClose} aria-label={t('common.close')}>
                        ×
                    </button>
                </div>

                <div className={styles.tabs}>
                    <button
                        className={`${styles.tab} ${activeTab === 'error' ? styles.active : ''}`}
                        onClick={() => setActiveTab('error')}
                    >
                        {t('errorDetailsModal.tabs.error')}
                    </button>
                    <button
                        className={`${styles.tab} ${activeTab === 'api' ? styles.active : ''}`}
                        onClick={() => setActiveTab('api')}
                    >
                        {t('errorDetailsModal.tabs.api')}
                    </button>
                    <button
                        className={`${styles.tab} ${activeTab === 'json' ? styles.active : ''}`}
                        onClick={() => setActiveTab('json')}
                    >
                        {t('errorDetailsModal.tabs.json')}
                    </button>
                </div>

                <div className={styles.content}>
                    {activeTab === 'error' && (
                        <div className={styles.section}>
                            <div className={styles.field}>
                                <label>{t('errorDetailsModal.labels.userMessage')}</label>
                                <div className={styles.value}>{errorDetails.userMessage || t('common.notAvailable')}</div>
                            </div>
                            <div className={styles.field}>
                                <label>{t('errorDetailsModal.labels.errorCode')}</label>
                                <div className={styles.value}>{errorDetails.errorCode || t('common.notAvailable')}</div>
                            </div>
                            {errorDetails.fullDetails?.errorMessage && (
                                <div className={styles.field}>
                                    <label>{t('errorDetailsModal.labels.techMessage')}</label>
                                    <div className={styles.value}>{errorDetails.fullDetails.errorMessage}</div>
                                </div>
                            )}
                            {errorDetails.fullDetails?.statusCode && (
                                <div className={styles.field}>
                                    <label>{t('errorDetailsModal.labels.statusCode')}</label>
                                    <div className={styles.value}>{errorDetails.fullDetails.statusCode}</div>
                                </div>
                            )}
                            {errorDetails.fullDetails?.requestId && (
                                <div className={styles.field}>
                                    <label>{t('errorDetailsModal.labels.requestId')}</label>
                                    <div className={styles.value}>{errorDetails.fullDetails.requestId}</div>
                                </div>
                            )}
                            {errorDetails.fullDetails?.errorData && (
                                <div className={styles.field}>
                                    <label>{t('errorDetailsModal.labels.errorData')}</label>
                                    <pre className={styles.jsonValue}>{formatJson(errorDetails.fullDetails.errorData)}</pre>
                                </div>
                            )}
                            {errorDetails.fullDetails?.stackTrace && (
                                <div className={styles.field}>
                                    <label>{t('errorDetailsModal.labels.stackTrace')}</label>
                                    <pre className={styles.stackTrace}>{errorDetails.fullDetails.stackTrace}</pre>
                                </div>
                            )}
                            {errorDetails.actionRequired && (
                                <div className={styles.field}>
                                    <label>{t('errorDetailsModal.labels.actionRequired')}</label>
                                    <div className={styles.value}>{errorDetails.actionRequired}</div>
                                </div>
                            )}
                        </div>
                    )}

                    {activeTab === 'api' && (
                        <div className={styles.section}>
                            {errorDetails.apiRequest ? (
                                <>
                                    <div className={styles.field}>
                                        <label>{t('errorDetailsModal.labels.operationName')}</label>
                                        <div className={styles.value}>{errorDetails.apiRequest.operationName || t('common.notAvailable')}</div>
                                    </div>
                                    <div className={styles.field}>
                                        <label>{t('errorDetailsModal.labels.queryMutation')}</label>
                                        <pre className={styles.queryValue}>{errorDetails.apiRequest.query || t('common.notAvailable')}</pre>
                                    </div>
                                    {errorDetails.apiRequest.variables && (
                                        <div className={styles.field}>
                                            <label>{t('errorDetailsModal.labels.variables')}</label>
                                            <pre className={styles.jsonValue}>{formatJson(errorDetails.apiRequest.variables)}</pre>
                                        </div>
                                    )}
                                    <div className={styles.actions}>
                                        <button
                                            className={styles.copyButton}
                                            onClick={handleCopyQuery}
                                        >
                                            {copiedQuery ? t('errorDetailsModal.copied') : t('errorDetailsModal.copyQuery')}
                                        </button>
                                    </div>
                                </>
                            ) : (
                                <div className={styles.emptyState}>{t('errorDetailsModal.emptyApi')}</div>
                            )}
                        </div>
                    )}

                    {activeTab === 'json' && (
                        <div className={styles.section}>
                            <pre className={styles.fullJson}>{formatJson(errorDetails)}</pre>
                        </div>
                    )}
                </div>

                <div className={styles.footer}>
                    <button className={styles.copyAllButton} onClick={handleCopyAll}>
                        {copied ? t('errorDetailsModal.copied') : t('errorDetailsModal.copyAll')}
                    </button>
                    <button className={styles.closeButtonFooter} onClick={onClose}>
                        {t('common.close')}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ErrorDetailsModal;

