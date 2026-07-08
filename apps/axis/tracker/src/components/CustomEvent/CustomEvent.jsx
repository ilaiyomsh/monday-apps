import React, { useRef, useState } from 'react';
import { format, differenceInMinutes } from 'date-fns';
import { useLocale } from '../../hooks/useLocale';
import { getEventColor, ROUTINE_COLOR_KEY } from '../../utils/colorUtils';
import { useProjectColors } from '../../contexts/ProjectColorsContext';
import logger from '../../utils/logger';

const LONG_PRESS_MS = 300;
const MOVE_TOLERANCE_PX = 8;

/**
 * רכיב מותאם אישית להצגת אירוע בלוח השנה
 */
const CustomEvent = ({ event, onLongPress, isMobile = false }) => {
    const { dateFnsLocale } = useLocale();
    const { colorMap } = useProjectColors();
    // עיצוב שונה לאירועים יומיים
    const isAllDayEvent = event.allDay;

    // בדיקה אם האירוע בטעינה (שלד)
    const isLoading = event.isLoading || false;

    // בדיקה אם זו היעדרות מלוח החופשות (Day-off) — שכבת תצוגה לקריאה בלבד (W4.3)
    const isDayOff = event.isDayOff || false;

    // בדיקה אם האירוע נבחר (מועבר דרך enrichedEvents)
    const isSelected = event.isSelected || false;

    // בדיקה אם זה אירוע מתוכנן (Temporary/Planned)
    const isTemporary = event.isTemporary || false;

    // בדיקה אם במצב בחירה לאישור
    const isInApprovalSelection = event.isInApprovalSelection || false;
    const isApprovalSelected = event.isApprovalSelected || false;

    // סטטוס אישור
    const isPending = event.isPending || false;
    const isRejected = event.isRejected || false;

    // אירוע פעיל ב-overlay של מובייל — מסתירים ויזואלית כדי שרק המסגרת הדינמית תוצג
    const isOverlayActive = event.isOverlayActive || false;

    // זיהוי אירוע קצר (30 דקות או פחות) - להציג כותרת ושעה באותה שורה
    const isShortEvent = !isAllDayEvent && event.start && event.end
        && differenceInMinutes(event.end, event.start) <= 30;

    // צבע הרקע לפי סוג האירוע או מזהה הפרויקט
    // אירועים מתוכננים מקבלים רקע שקוף (hollow)
    // דיווחי "שוטף" (לא לחיוב) ללא פרויקט — צבע אחיד מהמפתח הסינתטי
    const isRoutine = !isAllDayEvent && !event.projectId && event.eventType === 'לא לחיוב';
    const customColor = event.projectId
        ? colorMap[String(event.projectId)]
        : (isRoutine ? colorMap[ROUTINE_COLOR_KEY] : null);
    const eventColor = getEventColor(event.eventType, event.projectId || (isRoutine ? ROUTINE_COLOR_KEY : null), event.eventTypeColor, isAllDayEvent, customColor);

    // היעדרות Day-off שממתינה לאישור (המדיניות dayOffApprovalRequired פעילה — D2):
    // רינדור חלול (hollow) — רקע שקוף, מסגרת וטקסט בצבע סוג ההיעדרות — לסמן שטרם אושרה.
    // מאושרת (או כשהמדיניות כבויה — ה-hook לא מסמן isPending) — רינדור מלא רגיל.
    const isDayOffHollow = isDayOff && isPending;

    // אירועים מתוכננים והיעדרויות ממתינות - שקופים עם גבול צבעוני
    const isHollow = isTemporary || isDayOffHollow;
    const backgroundColor = isHollow ? 'transparent' : eventColor;

    // פרמוט זמן - הצבת שעת הסיום לפני שעת ההתחלה בקוד, כדי שבממשק RTL זה יוצג נכון:
    // שעת התחלה מימין, שעת סיום משמאל.
    const timeRange = !isAllDayEvent && event.start && event.end
        ? `${format(event.end, 'HH:mm', { locale: dateFnsLocale })} - ${format(event.start, 'HH:mm', { locale: dateFnsLocale })}`
        : '';

    // טקסט לבן על רקע צבעוני, או צבע האירוע על רקע שקוף (מתוכנן / היעדרות ממתינה)
    const textColor = isHollow ? eventColor : 'var(--color-text-inverse)';

    // חישוב opacity לפי סטטוס אישור: ממתין=חצי שקוף, מאושר/נדחה=מלא.
    // היעדרות Day-off ממתינה מסומנת ברינדור חלול במקום שקיפות (W4.3, D2)
    let opacity = 1;
    if (isPending && !isDayOff) opacity = 0.5;

    // בניית class names
    const wrapperClasses = [
        'gc-event-wrapper',
        isAllDayEvent ? 'gc-event-allday' : '',
        isShortEvent ? 'gc-event-short' : '',
        isSelected ? 'gc-event-selected' : '',
        isDayOff ? 'gc-event-dayoff' : '',
        isDayOffHollow ? 'gc-event-dayoff-pending' : '',
        isTemporary ? 'gc-event-temporary' : '',
        isApprovalSelected ? 'gc-event-approval-selected' : '',
        isLoading ? 'gc-event-loading' : ''
    ].filter(Boolean).join(' ');

    const wrapperStyle = isHollow
        ? { backgroundColor, color: textColor, '--event-color': eventColor, borderColor: eventColor, opacity }
        : {
            backgroundColor,
            color: textColor,
            opacity
        };

    if (isOverlayActive) {
        wrapperStyle.visibility = 'hidden';
    }

    // תפריט לחיצה ימנית — preventDefault מוכרח כאן כדי לבלוק את תפריט הדפדפן
    // ה-DnD wrapper של react-big-calendar עלול לבלוע את ה-event לפני שה-handler שלנו קורא preventDefault
    // stopPropagation מונע מה-DnD wrapper לטפל גם הוא באותו event
    const handleContextMenu = (e) => {
        e.preventDefault();
        e.stopPropagation();
        event.onContextMenu && event.onContextMenu(e);
    };

    // Long-press למובייל — מפעיל overlay לעריכת ידיות (גרירה/שינוי גודל)
    const longPressTimerRef = useRef(null);
    const longPressStartPosRef = useRef(null);
    const lastPointerYRef = useRef(null);
    const [pressing, setPressing] = useState(false);

    const longPressEnabled = isMobile
        && !!onLongPress
        && !isLoading
        && !isAllDayEvent
        && !isInApprovalSelection;

    const clearLongPress = () => {
        if (longPressTimerRef.current) {
            clearTimeout(longPressTimerRef.current);
            longPressTimerRef.current = null;
        }
        longPressStartPosRef.current = null;
        setPressing(false);
    };

    const handlePointerDown = (e) => {
        if (!longPressEnabled) return;
        if (e.pointerType === 'mouse') return;
        longPressStartPosRef.current = { x: e.clientX, y: e.clientY };
        lastPointerYRef.current = e.clientY;
        setPressing(true);
        longPressTimerRef.current = setTimeout(() => {
            longPressTimerRef.current = null;
            setPressing(false);
            try {
                navigator.vibrate?.(15);
            } catch (vibrateError) {
                // רטט הוא best-effort בלבד; כשל לא חוסם את ה-long-press אך נרשם כדי שלא יהיה dark
                logger.debug('CustomEvent', 'navigator.vibrate נכשל (לא חוסם)', vibrateError);
            }
            // מעבירים את המיקום הנוכחי של האצבע ל-overlay כדי שיוכל
            // להמשיך את הגרירה ברציפות בלי שהמשתמש ישחרר וילחץ שוב
            onLongPress(event, { initialClientY: lastPointerYRef.current });
        }, LONG_PRESS_MS);
    };

    const handlePointerMove = (e) => {
        // מעדכנים את המיקום האחרון של האצבע גם בזמן ההמתנה ל-long-press
        lastPointerYRef.current = e.clientY;
        const start = longPressStartPosRef.current;
        if (!start) return;
        const dx = Math.abs(e.clientX - start.x);
        const dy = Math.abs(e.clientY - start.y);
        if (dx > MOVE_TOLERANCE_PX || dy > MOVE_TOLERANCE_PX) {
            clearLongPress();
        }
    };

    const wrapperClassName = pressing
        ? `${wrapperClasses} gc-event-pressing`
        : wrapperClasses;

    return (
        <div
            className={wrapperClassName}
            style={wrapperStyle}
            data-event-id={event.id}
            onContextMenu={handleContextMenu}
            onPointerDown={longPressEnabled ? handlePointerDown : undefined}
            onPointerMove={longPressEnabled ? handlePointerMove : undefined}
            onPointerUp={longPressEnabled ? clearLongPress : undefined}
            onPointerCancel={longPressEnabled ? clearLongPress : undefined}
            onPointerLeave={longPressEnabled ? clearLongPress : undefined}
        >
            {/* ספינר טעינה לאירוע בתהליך יצירה */}
            {isLoading && (
                <span className="gc-event-loader" />
            )}
            {/* X קטן אדום בפינה השמאלית העליונה לאירועים שנדחו */}
            {isRejected && (
                <span className="gc-event-rejected-x">✕</span>
            )}
            {/* Checkbox במצב בחירה לאישור */}
            {isInApprovalSelection && (
                <span className="gc-event-approval-checkbox">
                    {isApprovalSelected ? '☑' : '☐'}
                </span>
            )}
            <div className="gc-event-title">
                {event.title}
            </div>
            {timeRange && (
                <div className="gc-event-time">
                    {timeRange}
                </div>
            )}
        </div>
    );
};

export default CustomEvent;
