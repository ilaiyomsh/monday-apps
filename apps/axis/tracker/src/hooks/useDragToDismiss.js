import { useRef, useState, useCallback } from 'react';

const DISMISS_THRESHOLD_PX = 120;

/**
 * Hook לסגירת מודל מובייל בגרירה כלפי מטה (סגנון bottom-sheet).
 * מחזיר handlers להצמדה ל-element הסוחב (כותרת/grabber), ו-style להחלת transform על המודל.
 *
 * @param {object} opts
 * @param {boolean} opts.enabled - האם להפעיל (בד"כ isMobile && !isLocked)
 * @param {() => void} opts.onDismiss - callback לקריאה כשמשלימים את הגרירה
 */
export const useDragToDismiss = ({ enabled, onDismiss }) => {
    const [translateY, setTranslateY] = useState(0);
    const startYRef = useRef(null);
    const draggingRef = useRef(false);

    const onPointerDown = useCallback((e) => {
        if (!enabled) return;
        if (e.pointerType === 'mouse') return; // רק מגע
        startYRef.current = e.clientY;
        draggingRef.current = true;
    }, [enabled]);

    const onPointerMove = useCallback((e) => {
        if (!draggingRef.current || startYRef.current == null) return;
        const dy = e.clientY - startYRef.current;
        // רק גרירה כלפי מטה
        if (dy <= 0) {
            setTranslateY(0);
            return;
        }
        // התנגדות קלה כדי שזה ירגיש "אמיתי"
        setTranslateY(dy);
    }, []);

    const finish = useCallback(() => {
        if (!draggingRef.current) return;
        draggingRef.current = false;
        startYRef.current = null;
        if (translateY > DISMISS_THRESHOLD_PX) {
            // החלקה מלאה החוצה לפני סגירה
            setTranslateY(window.innerHeight);
            setTimeout(() => {
                setTranslateY(0);
                onDismiss?.();
            }, 180);
        } else {
            // חזרה למקום
            setTranslateY(0);
        }
    }, [translateY, onDismiss]);

    const handleProps = enabled ? {
        onPointerDown,
        onPointerMove,
        onPointerUp: finish,
        onPointerCancel: finish,
    } : {};

    const modalStyle = enabled && translateY > 0 ? {
        transform: `translateY(${translateY}px)`,
        transition: draggingRef.current ? 'none' : 'transform 180ms ease-out',
    } : undefined;

    return { handleProps, modalStyle };
};
