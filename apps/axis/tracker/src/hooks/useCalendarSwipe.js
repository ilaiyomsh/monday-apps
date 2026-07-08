import { useCallback, useRef } from 'react';
import { useSwipeable } from 'react-swipeable';
import { useLocale } from './useLocale';

// Hook לניהול תנועת swipe במובייל — מצב, refs לעקיבה אחרי האצבע, וחישוב התאריך הסמוך.
// מוצא חוצה ל-MondayCalendar כחלק מ-Wave 5.1.0 (F005).
export function useCalendarSwipe({ calendarDate, calendarView, setCalendarDate, isMobile }) {
    const { isLtr } = useLocale();
    // Refs ל-finger-following — מתעדכנים ישירות ב-DOM ללא re-render בכל frame
    const swipeContentRef = useRef(null);
    const swipePeekRef = useRef(null);
    const swipeActiveRef = useRef(false);

    const computeAdjacentDate = useCallback((dir) => {
        // RTL (he): גרירת אצבע ימינה (dir=+1) = היום הבא; שמאלה (dir=-1) = הקודם
        // LTR (en): הפוך — גרירה שמאלה = הבא, ימינה = הקודם
        const sign = isLtr ? (dir < 0 ? +1 : -1) : (dir < 0 ? -1 : +1);
        if (calendarView === 'three_day') return new Date(calendarDate.getTime() + sign * 3 * 86400000);
        if (calendarView === 'day') return new Date(calendarDate.getTime() + sign * 86400000);
        return new Date(calendarDate.getFullYear(), calendarDate.getMonth() + sign, 1);
    }, [calendarDate, calendarView, isLtr]);

    // טקסט "peek" של היום הבא/הקודם שמופיע בצד במהלך סוויפ
    const HEBREW_WEEKDAYS_PEEK = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'שבת'];
    const formatPeekLabel = (d) => {
        const i = d.getDay();
        const day = i === 6 ? HEBREW_WEEKDAYS_PEEK[i] : `יום ${HEBREW_WEEKDAYS_PEEK[i]}`;
        return { day, num: String(d.getDate()) };
    };

    const swipeHandlers = useSwipeable({
        onSwiping: (e) => {
            if (!isMobile) return;
            if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) return;
            const el = swipeContentRef.current;
            const peek = swipePeekRef.current;
            if (!el) return;
            swipeActiveRef.current = true;
            el.style.transition = 'none';
            el.style.transform = `translateX(${e.deltaX}px)`;
            if (peek) {
                // עוצמת ה-peek: 0 כש-deltaX=0, 1 כשעבר 50% מהמסך
                const screenW = window.innerWidth;
                const intensity = Math.min(1, Math.abs(e.deltaX) / (screenW * 0.5));
                peek.style.opacity = String(intensity);
                // צד התווית: deltaX<0 (next) → מופיע משמאל; deltaX>0 (prev) → מימין
                const dir = e.deltaX < 0 ? -1 : 1;
                const adj = computeAdjacentDate(dir);
                const { day, num } = formatPeekLabel(adj);
                peek.querySelector('.gc-peek-day').textContent = day;
                peek.querySelector('.gc-peek-num').textContent = num;
                peek.style.left = dir < 0 ? '24px' : 'auto';
                peek.style.right = dir > 0 ? '24px' : 'auto';
            }
        },
        onSwiped: (e) => {
            if (!isMobile) return;
            const el = swipeContentRef.current;
            const peek = swipePeekRef.current;
            if (!el || !swipeActiveRef.current) return;
            swipeActiveRef.current = false;
            const screenWidth = window.innerWidth;
            const threshold = screenWidth * 0.22;
            const isHorizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY);

            if (peek) peek.style.opacity = '0';

            if (!isHorizontal || Math.abs(e.deltaX) < threshold) {
                el.style.transition = 'transform 180ms ease-out';
                el.style.transform = 'translateX(0)';
                return;
            }

            const dir = e.deltaX < 0 ? -1 : 1;
            el.style.transition = 'transform 180ms ease-out';
            el.style.transform = `translateX(${dir * screenWidth}px)`;

            setTimeout(() => {
                setCalendarDate(computeAdjacentDate(dir));
                if (!el) return;
                el.style.transition = 'none';
                el.style.transform = `translateX(${-dir * screenWidth}px)`;
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        if (!el) return;
                        el.style.transition = 'transform 180ms ease-out';
                        el.style.transform = 'translateX(0)';
                    });
                });
            }, 180);
        },
        delta: 10,
        preventScrollOnSwipe: false,
        trackTouch: true,
        trackMouse: false,
    });

    return {
        swipeHandlers,
        swipeContentRef,
        swipePeekRef,
        computeAdjacentDate,
    };
}

export default useCalendarSwipe;
