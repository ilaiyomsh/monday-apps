import React from 'react';
import { createPortal } from 'react-dom';
import { Copy, Trash2, X, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import styles from './SelectionActionBar.module.css';

/**
 * סרגל פעולות לאירועים נבחרים
 * מוצג כ-floating bar בתחתית המסך כאשר יש אירועים נבחרים
 */
const SelectionActionBar = ({ 
    selectedCount, 
    onDuplicate, 
    onDelete, 
    onClear,
    isProcessing
}) => {
    const { t } = useTranslation();

    if (selectedCount === 0) return null;
    if (typeof document === 'undefined') return null;

    return createPortal(
        <div className={styles.actionBar}>
            <div className={styles.content}>
                <span className={styles.count}>
                    {selectedCount === 1
                        ? t('selection.actionBar.oneSelected')
                        : t('selection.actionBar.manySelected', { count: selectedCount })}
                </span>

                <div className={styles.actions}>
                    <button
                        onClick={onDuplicate}
                        disabled={isProcessing}
                        className={styles.actionBtn}
                        title={t('selection.actionBar.duplicateTooltip')}
                    >
                        {isProcessing ? (
                            <Loader2 size={18} className={styles.spinner} />
                        ) : (
                            <Copy size={18} />
                        )}
                        <span>{t('selection.actionBar.duplicate')}</span>
                    </button>

                    <button
                        onClick={onDelete}
                        disabled={isProcessing}
                        className={`${styles.actionBtn} ${styles.deleteBtn}`}
                        title={t('selection.actionBar.deleteTooltip')}
                    >
                        {isProcessing ? (
                            <Loader2 size={18} className={styles.spinner} />
                        ) : (
                            <Trash2 size={18} />
                        )}
                        <span>{t('selection.actionBar.delete')}</span>
                    </button>

                    <button
                        onClick={onClear}
                        className={styles.clearBtn}
                        title={t('selection.actionBar.clearTooltip')}
                        disabled={isProcessing}
                    >
                        <X size={20} />
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
};

export default SelectionActionBar;
