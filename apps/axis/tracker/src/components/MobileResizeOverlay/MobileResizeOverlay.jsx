import React, { useEffect, useRef, useState, useMemo } from 'react';
import { format } from 'date-fns';
import { useStableT } from '../../i18n/useStableT';
import { useLocale } from '../../hooks/useLocale';
import styles from './MobileResizeOverlay.module.css';
import { getEventColor, ROUTINE_COLOR_KEY } from '../../utils/colorUtils';
import { useProjectColors } from '../../contexts/ProjectColorsContext';
import logger from '../../utils/logger';

const SNAP_MINUTES = 15;
const MIN_DURATION_MINUTES = 15;
const TAP_MOVE_TOLERANCE_PX = 8;

const snapTo = (date, minutes) => {
    const ms = minutes * 60 * 1000;
    return new Date(Math.round(date.getTime() / ms) * ms);
};

const dayBoundaries = (date) => {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { dayStart: start, dayEnd: end };
};

const MobileResizeOverlay = ({ event, onCommit, onMove, onCancel, initialTouchY }) => {
    const t = useStableT();
    const { dateFnsLocale } = useLocale();
    const { colorMap } = useProjectColors();
    const [start, setStart] = useState(event.start);
    const [end, setEnd] = useState(event.end);
    const [rect, setRect] = useState(null);
    const minutesPerPixelRef = useRef(0);
    const dragStateRef = useRef(null);

    // המשך גרירה רציפה ישירות מה-long-press: כשמועבר initialTouchY,
    // נאתחל את ה-dragState כאילו handleBodyStart נקרא — וה-window listeners
    // (touchmove/touchend) יקלטו את ההזזה הבאה של אותה אצבע
    useEffect(() => {
        if (initialTouchY != null && !dragStateRef.current) {
            dragStateRef.current = {
                kind: 'move',
                startY: initialTouchY,
                origStart: start,
                origEnd: end,
                moved: false,
            };
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialTouchY]);

    const isRoutine = !event.allDay && !event.projectId && event.eventType === 'לא לחיוב';
    const customColor = event.projectId
        ? colorMap[String(event.projectId)]
        : (isRoutine ? colorMap[ROUTINE_COLOR_KEY] : null);
    const projectIdForColor = event.projectId || (isRoutine ? ROUTINE_COLOR_KEY : null);
    const eventColor = useMemo(
        () => getEventColor(event.eventType, projectIdForColor, event.eventTypeColor, event.allDay, customColor),
        [event.eventType, projectIdForColor, event.eventTypeColor, event.allDay, customColor]
    );

    // איתור האירוע במסך וחישוב mapping של פיקסל→דקות
    useEffect(() => {
        const computeRect = () => {
            try {
                const wrapper = document.querySelector(`[data-event-id="${event.id}"]`);
                const rbcEvent = wrapper?.closest('.rbc-event');
                const target = rbcEvent || wrapper;
                if (!target) return;
                const r = target.getBoundingClientRect();
                const durationMin = (event.end - event.start) / 60000;
                minutesPerPixelRef.current = durationMin / r.height;
                setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
            } catch (error) {
                logger.error('MobileResizeOverlay', 'computeRect failed', error);
            }
        };
        computeRect();
        window.addEventListener('scroll', computeRect, true);
        window.addEventListener('resize', computeRect);
        return () => {
            window.removeEventListener('scroll', computeRect, true);
            window.removeEventListener('resize', computeRect);
        };
    }, [event.id, event.start, event.end]);

    // עדכון rect בעת שינוי start/end (frame עוקב אחרי הזמנים)
    const visualRect = useMemo(() => {
        if (!rect) return null;
        const mpp = minutesPerPixelRef.current || 1;
        const startDeltaMin = (start - event.start) / 60000;
        const endDeltaMin = (end - event.end) / 60000;
        const newTop = rect.top + startDeltaMin / mpp;
        const newHeight = rect.height + (endDeltaMin - startDeltaMin) / mpp;
        return { top: newTop, left: rect.left, width: rect.width, height: newHeight };
    }, [rect, start, end, event.start, event.end]);

    const handleHandleStart = (which) => (e) => {
        const touch = e.touches[0];
        if (!touch) return;
        e.stopPropagation();
        dragStateRef.current = {
            kind: 'resize',
            which,
            startY: touch.clientY,
            origStart: start,
            origEnd: end,
            moved: false,
        };
    };

    const handleBodyStart = (e) => {
        const touch = e.touches[0];
        if (!touch) return;
        dragStateRef.current = {
            kind: 'move',
            startY: touch.clientY,
            origStart: start,
            origEnd: end,
            moved: false,
        };
    };

    const handleMove = (e) => {
        const drag = dragStateRef.current;
        if (!drag) return;
        const touch = e.touches[0];
        if (!touch) return;
        const dy = touch.clientY - drag.startY;
        if (Math.abs(dy) > TAP_MOVE_TOLERANCE_PX) drag.moved = true;
        e.preventDefault();
        const deltaMin = Math.round((dy * minutesPerPixelRef.current) / SNAP_MINUTES) * SNAP_MINUTES;
        const { dayStart, dayEnd } = dayBoundaries(event.start);

        if (drag.kind === 'resize' && drag.which === 'start') {
            let next = new Date(drag.origStart.getTime() + deltaMin * 60000);
            next = snapTo(next, SNAP_MINUTES);
            if (next < dayStart) next = dayStart;
            if (next.getTime() >= drag.origEnd.getTime() - MIN_DURATION_MINUTES * 60000) {
                next = new Date(drag.origEnd.getTime() - MIN_DURATION_MINUTES * 60000);
            }
            setStart(next);
        } else if (drag.kind === 'resize' && drag.which === 'end') {
            let next = new Date(drag.origEnd.getTime() + deltaMin * 60000);
            next = snapTo(next, SNAP_MINUTES);
            if (next > dayEnd) next = dayEnd;
            if (next.getTime() <= drag.origStart.getTime() + MIN_DURATION_MINUTES * 60000) {
                next = new Date(drag.origStart.getTime() + MIN_DURATION_MINUTES * 60000);
            }
            setEnd(next);
        } else if (drag.kind === 'move') {
            const durationMs = drag.origEnd.getTime() - drag.origStart.getTime();
            let nextStart = new Date(drag.origStart.getTime() + deltaMin * 60000);
            nextStart = snapTo(nextStart, SNAP_MINUTES);
            if (nextStart < dayStart) nextStart = dayStart;
            let nextEnd = new Date(nextStart.getTime() + durationMs);
            if (nextEnd > dayEnd) {
                nextEnd = dayEnd;
                nextStart = new Date(nextEnd.getTime() - durationMs);
            }
            setStart(nextStart);
            setEnd(nextEnd);
        }
    };

    const handleEnd = () => {
        const drag = dragStateRef.current;
        dragStateRef.current = null;
        if (!drag) return;

        // tap נטו על המסגרת (ללא גרירה) — לא עושים כלום, ה-overlay נשאר פתוח עד סגירה ב-✕ או backdrop
        if (!drag.moved) return;

        const startChanged = start.getTime() !== event.start.getTime();
        const endChanged = end.getTime() !== event.end.getTime();
        if (!startChanged && !endChanged) return;

        // ויברציה קצרה כפידבק לסיום פעולה מוצלחת
        try { navigator.vibrate?.(10); } catch (error) { logger.warn('MobileResizeOverlay', 'navigator.vibrate failed', error); }

        if (drag.kind === 'resize') {
            onCommit(start, end);
        } else if (drag.kind === 'move') {
            onMove(start, end);
        }
    };

    // listeners ברמת window כדי לעקוב אחרי האצבע גם אם יוצאת מהאלמנט
    useEffect(() => {
        const move = (e) => {
            try {
                handleMove(e);
            } catch (error) {
                logger.error('MobileResizeOverlay', 'touchmove handler failed', error);
            }
        };
        const up = () => {
            try {
                handleEnd();
            } catch (error) {
                logger.error('MobileResizeOverlay', 'touchend handler failed', error);
            }
        };
        window.addEventListener('touchmove', move, { passive: false });
        window.addEventListener('touchend', up);
        window.addEventListener('touchcancel', up);
        return () => {
            window.removeEventListener('touchmove', move);
            window.removeEventListener('touchend', up);
            window.removeEventListener('touchcancel', up);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [start, end]);

    if (!visualRect) return null;

    const frameStyle = {
        top: `${visualRect.top}px`,
        left: `${visualRect.left}px`,
        width: `${visualRect.width}px`,
        height: `${visualRect.height}px`,
        '--frame-color': eventColor,
        background: `${eventColor}33`, // alpha 0.2
    };

    return (
        <>
            <div
                className={styles.backdrop}
                onClick={(e) => {
                    if (e.target === e.currentTarget) onCancel();
                }}
            />
            <div
                className={styles.frame}
                style={frameStyle}
                onTouchStart={handleBodyStart}
            >
                <div
                    className={`${styles.handle} ${styles.handleStart}`}
                    onTouchStart={handleHandleStart('start')}
                    aria-label={t('mobileResize.dragStartAria')}
                />
                <div className={`${styles.timeBubble} ${styles.timeBubbleStart}`} style={{ background: eventColor }}>
                    {format(start, 'HH:mm', { locale: dateFnsLocale })}
                </div>
                <div
                    className={`${styles.handle} ${styles.handleEnd}`}
                    onTouchStart={handleHandleStart('end')}
                    aria-label={t('mobileResize.dragEndAria')}
                />
                <div className={`${styles.timeBubble} ${styles.timeBubbleEnd}`} style={{ background: eventColor }}>
                    {format(end, 'HH:mm', { locale: dateFnsLocale })}
                </div>
                <button
                    type="button"
                    className={styles.closeButton}
                    onClick={(e) => { e.stopPropagation(); onCancel(); }}
                    onTouchEnd={(e) => { e.stopPropagation(); e.preventDefault(); onCancel(); }}
                    aria-label={t('common.close')}
                >
                    ✕
                </button>
            </div>
        </>
    );
};

export default MobileResizeOverlay;
