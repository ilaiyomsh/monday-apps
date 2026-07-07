import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Undo2 } from 'lucide-react';
import styles from './UndoBanner.module.css';
import logger from '../../utils/logger';

/**
 * באנר Undo למחיקת אירועים
 * מוצג בתחתית המסך למשך מספר שניות עם אפשרות ביטול
 */
const UndoBanner = ({ isVisible, message, onUndo }) => {
    const { t } = useTranslation();
    const [exiting, setExiting] = useState(false);
    // ref ל-timer של אנימציית היציאה (200ms) לניקוי ב-unmount ולמניעת דליפה
    const exitTimerRef = useRef(null);

    // אנימציית יציאה כשהבאנר נעלם
    useEffect(() => {
        if (!isVisible && exiting) {
            setExiting(false);
        }
    }, [isVisible, exiting]);

    // ניקוי ה-timer של אנימציית היציאה כשהקומפוננטה מתפרקת
    useEffect(() => {
        return () => {
            if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
        };
    }, []);

    const handleUndo = useCallback(() => {
        setExiting(true);
        // המתנה לסיום אנימציית היציאה
        exitTimerRef.current = setTimeout(() => {
            try {
                onUndo();
            } catch (error) {
                logger.error('UndoBanner', 'onUndo handler failed', error);
            }
        }, 200);
    }, [onUndo]);

    if (!isVisible) return null;
    if (typeof document === 'undefined') return null;

    return createPortal(
        <div className={`${styles.banner} ${exiting ? styles.exiting : ''}`}>
            <span className={styles.message}>{message}</span>
            <button className={styles.undoButton} onClick={handleUndo}>
                <Undo2 size={16} />
                <span>{t('common.undo')}</span>
            </button>
        </div>,
        document.body
    );
};

export default UndoBanner;
