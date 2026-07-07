import React, { useEffect, useRef } from 'react';
import { Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import styles from './ContextMenu.module.css';

/**
 * תפריט לחיצה ימנית לאירוע בלוח השנה
 * מוצג במיקום העכבר עם אופציית מחיקה
 */
const ContextMenu = ({ isOpen, position, onDelete, onClose }) => {
    const { t } = useTranslation();
    const menuRef = useRef(null);

    useEffect(() => {
        if (!isOpen) return;

        const handleClickOutside = (e) => {
            if (menuRef.current && !menuRef.current.contains(e.target)) {
                onClose();
            }
        };

        const handleEsc = (e) => {
            if (e.key === 'Escape') onClose();
        };

        // השהייה קצרה כדי לא לתפוס את האירוע שפתח את התפריט
        const timer = setTimeout(() => {
            document.addEventListener('mousedown', handleClickOutside);
            document.addEventListener('keydown', handleEsc);
        }, 0);

        return () => {
            clearTimeout(timer);
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleEsc);
        };
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    return (
        <div
            ref={menuRef}
            className={styles.menu}
            style={{ top: position.y, left: position.x }}
        >
            <button
                className={`${styles.menuItem} ${styles.deleteItem}`}
                onClick={onDelete}
            >
                <Trash2 size={16} />
                <span>{t('selection.contextMenu.deleteEvent')}</span>
            </button>
        </div>
    );
};

export default ContextMenu;
