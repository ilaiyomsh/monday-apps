/**
 * useCelebration — guard היעדרויות Day-off (נוסף ב-W4.2, מכוסה כאן ב-W4.8):
 * אירועי שכבת ההיעדרויות (isDayOff) לעולם לא נספרים כשעות מדווחות לאבני
 * הדרך — getTimedHoursForDate מדלג עליהם במפורש (שכבה מקבילה לחגים, D10).
 *
 * הנעילה כפולה: (1) היעדרות על היום לא מדכאת את חגיגת "הדיווח הראשון";
 * (2) ה-guard המפורש על isDayOff מכוסה בנפרד מהדילוג על allDay — גם אירוע
 * day-off היפותטי שאינו all-day לא נספר (הגנה-לעומק, useCelebration.js).
 * בקרת control עם דיווח רגיל מוכיחה שהספירה עצמה עובדת — כלומר ה-guard
 * הוא מה שמחריג את ה-day-off, לא סביבת הטסט.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCelebration } from '../useCelebration';
import confetti from 'canvas-confetti';

// canvas-confetti מנסה לכתוב ל-canvas שלא קיים ב-jsdom — אותה הגנה כמו
// בסוויטות האינטגרציה; ה-mock גם משמש לאימות שהחגיגה אכן נורתה
vi.mock('canvas-confetti', () => ({
    default: vi.fn()
}));

// היום הנבדק — 5 במאי 2026
const DAY = new Date(2026, 4, 5, 10, 0, 0);

// אירוע overlay של Day-off כפי שה-hook של W4.1 מייצר: רב-יומי, all-day,
// read-only, מכסה את היום הנבדק (5–7 במאי, end בלעדי 8 במאי)
const dayOffOverlayEvent = {
    id: 'dayoff_71',
    title: 'חופשה',
    allDay: true,
    isDayOff: true,
    readOnly: true,
    start: new Date(2026, 4, 5, 0, 0, 0),
    end: new Date(2026, 4, 8, 0, 0, 0)
};

// אירוע day-off היפותטי שאינו all-day — מבודד את ה-guard המפורש על isDayOff
// מהדילוג הקודם על event.allDay (שני תנאים נפרדים בקוד)
const timedDayOffEvent = {
    id: 'dayoff_72',
    title: 'חופשה',
    allDay: false,
    isDayOff: true,
    readOnly: true,
    start: new Date(2026, 4, 5, 9, 0, 0),
    end: new Date(2026, 4, 5, 11, 0, 0)
};

// דיווח שעתי רגיל קיים על אותו יום (2 שעות) — ה-control
const existingTimedEvent = {
    id: 'evt-1',
    title: 'עבודה',
    allDay: false,
    start: new Date(2026, 4, 5, 7, 0, 0),
    end: new Date(2026, 4, 5, 9, 0, 0)
};

// הדיווח החדש שנוצר (2 שעות) — מועבר ל-checkCelebration כ-newEvent
const newTimedEvent = {
    id: 'evt-new',
    title: 'עבודה חדשה',
    allDay: false,
    start: new Date(2026, 4, 5, 11, 0, 0),
    end: new Date(2026, 4, 5, 13, 0, 0)
};

describe('useCelebration — אירועי Day-off לא נספרים כשעות מדווחות (W4.2/W4.8)', () => {

    let showSuccess;

    beforeEach(() => {
        vi.mocked(confetti).mockClear();
        showSuccess = vi.fn();
    });

    function celebrateWith(events) {
        const { result } = renderHook(() => useCelebration(events, showSuccess, 8.5));
        act(() => {
            result.current.captureBeforeState(DAY);
        });
        let celebrated;
        act(() => {
            celebrated = result.current.checkCelebration(DAY, newTimedEvent);
        });
        return celebrated;
    }

    it('היעדרות Day-off על היום לא מדכאת את חגיגת "הדיווח הראשון ביום"', () => {
        // אם האירוע היה נספר, before.count היה 1 והחגיגה לא הייתה נורית
        const celebrated = celebrateWith([dayOffOverlayEvent]);

        expect(celebrated).toBe(true);
        expect(showSuccess).toHaveBeenCalledTimes(1);
        // עוצמת 'small' = ירייה אחת (דיווח ראשון ביום)
        expect(confetti).toHaveBeenCalledTimes(1);
    });

    it('גם אירוע day-off שאינו all-day לא נספר — ה-guard המפורש על isDayOff ננעל', () => {
        // עוקף את הדילוג על allDay ומגיע ישירות ל-`if (event.isDayOff) continue`
        const celebrated = celebrateWith([timedDayOffEvent]);

        expect(celebrated).toBe(true);
        expect(showSuccess).toHaveBeenCalledTimes(1);
        expect(confetti).toHaveBeenCalledTimes(1);
    });

    it('control: דיווח שעתי רגיל קיים כן נספר — אין חגיגת "דיווח ראשון" שנייה', () => {
        // before.count=1 (הדיווח הקיים) ⇒ אבן הדרך "דיווח ראשון" לא נחצית;
        // before.hours=2, after=4 < 4.25 (חצי יום) ⇒ אף אבן דרך אחרת לא נחצית.
        // מוכיח שהספירה עובדת — ההחרגה בטסטים שמעל היא בזכות ה-guard.
        const celebrated = celebrateWith([existingTimedEvent]);

        expect(celebrated).toBe(false);
        expect(showSuccess).not.toHaveBeenCalled();
        expect(confetti).not.toHaveBeenCalled();
    });
});
