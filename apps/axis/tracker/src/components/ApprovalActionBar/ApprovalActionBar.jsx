import React from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2 } from 'lucide-react';
import { useStableT } from '../../i18n/useStableT';
import styles from './ApprovalActionBar.module.css';

/**
 * סרגל פעולות אישור מנהל לאירועים נבחרים
 * מוצג כ-floating bar בתחתית המסך כאשר יש אירועים נבחרים לאישור
 */
const ApprovalActionBar = ({
    selectedCount,
    onApprove,
    onClear,
    isProcessing
}) => {
    const t = useStableT();
    if (selectedCount === 0) return null;
    if (typeof document === 'undefined') return null;

    return createPortal(
        <div className={styles.actionBar}>
            <div className={styles.content}>
                <span className={styles.count}>
                    {t('approval.actionBar.selectedCount', { count: selectedCount })}
                </span>

                <div className={styles.actions}>
                    <button
                        onClick={onApprove}
                        disabled={isProcessing}
                        className={styles.approveBtn}
                        title={t('approval.actionBar.approveSelectedTitle')}
                    >
                        {isProcessing ? (
                            <Loader2 size={18} className={styles.spinner} />
                        ) : null}
                        <span>{isProcessing ? t('approval.actionBar.approving') : t('approval.actionBar.approve')}</span>
                    </button>

                    <button
                        onClick={onClear}
                        className={styles.clearBtn}
                        title={t('approval.actionBar.clearSelection')}
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

export default ApprovalActionBar;
