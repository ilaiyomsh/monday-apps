import { useEffect, useRef } from 'react';
import logger from '../utils/logger';

const FOCUSABLE_SELECTOR = 'a[href], button:not(:disabled), textarea:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])';

/**
 * Focus trap hook - לכידת פוקוס בתוך מודאל
 * @param {boolean} isOpen - האם המודאל פתוח
 * @param {function} onEscape - callback ללחיצת Escape
 * @returns {React.RefObject} ref לאלמנט המכיל
 */
export function useFocusTrap(isOpen, onEscape) {
    const containerRef = useRef(null);
    const previousFocusRef = useRef(null);
    // שמירת onEscape ב-ref כדי שהאפקט לא ירוץ מחדש בכל שינוי reference
    const onEscapeRef = useRef(onEscape);
    onEscapeRef.current = onEscape;

    useEffect(() => {
        if (!isOpen) return;

        // שמירת האלמנט שהיה בפוקוס לפני פתיחת המודאל
        previousFocusRef.current = document.activeElement;

        // פוקוס על האלמנט הראשון בתוך המודאל
        const container = containerRef.current;
        if (!container) return;

        const focusFirst = () => {
            try {
                const focusable = container.querySelectorAll(FOCUSABLE_SELECTOR);
                if (focusable.length > 0) {
                    focusable[0].focus();
                } else {
                    container.focus();
                }
            } catch (error) {
                logger.error('useFocusTrap', 'focusFirst failed', error);
            }
        };

        // עיכוב קטן לאפשר לאנימציה להתחיל
        const timer = setTimeout(focusFirst, 50);

        const handleKeyDown = (e) => {
            try {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    if (onEscapeRef.current) onEscapeRef.current();
                    return;
                }

                if (e.key !== 'Tab') return;

                const focusable = container.querySelectorAll(FOCUSABLE_SELECTOR);
                if (focusable.length === 0) return;

                const first = focusable[0];
                const last = focusable[focusable.length - 1];

                if (e.shiftKey) {
                    if (document.activeElement === first || !container.contains(document.activeElement)) {
                        e.preventDefault();
                        last.focus();
                    }
                } else {
                    if (document.activeElement === last || !container.contains(document.activeElement)) {
                        e.preventDefault();
                        first.focus();
                    }
                }
            } catch (error) {
                logger.error('useFocusTrap', 'keydown handler failed', error);
            }
        };

        container.addEventListener('keydown', handleKeyDown);

        return () => {
            clearTimeout(timer);
            container.removeEventListener('keydown', handleKeyDown);
            // החזרת פוקוס לאלמנט המקורי
            if (previousFocusRef.current && previousFocusRef.current.focus) {
                previousFocusRef.current.focus();
            }
        };
    }, [isOpen]);

    return containerRef;
}
