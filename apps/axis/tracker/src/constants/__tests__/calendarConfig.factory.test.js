import { describe, it, expect } from 'vitest';

// TDD: Increment 6 — הפיכת calendarConfig מקובץ קבוע ל-factory מקבל פרמטרים.
// כרגע calendarConfig מחזיק מחרוזות עבריות קשיחות; ה-factory עוד לא קיים.
import {
    createCalendarConfig,
    createLocalizer,
    createMessages
} from '../calendarConfig.factory';

describe('calendarConfig factory (Increment 6)', () => {

    describe('createCalendarConfig', () => {
        it('מחזיר { localizer, messages, formats } לעברית', () => {
            const cfg = createCalendarConfig({
                language: 'he',
                weekStartDay: 0,
                workDays: [0, 1, 2, 3, 4],
                timeFormat: '24h'
            });
            expect(cfg).toHaveProperty('localizer');
            expect(cfg).toHaveProperty('messages');
            expect(cfg).toHaveProperty('formats');
        });

        it('מחזיר messages עבריים כשהשפה he', () => {
            const cfg = createCalendarConfig({ language: 'he', weekStartDay: 0, workDays: [0,1,2,3,4] });
            const allMessages = Object.values(cfg.messages).join(' ');
            expect(allMessages).toMatch(/[א-ת]/);
        });

        it('מחזיר messages באנגלית כשהשפה en', () => {
            const cfg = createCalendarConfig({ language: 'en', weekStartDay: 0, workDays: [0,1,2,3,4] });
            const allMessages = Object.values(cfg.messages).join(' ');
            expect(allMessages).not.toMatch(/[א-ת]/);
            expect(allMessages.toLowerCase()).toMatch(/today|next|previous/);
        });

        it('שפה לא נתמכת נופלת לעברית', () => {
            const cfg = createCalendarConfig({ language: 'fr', weekStartDay: 0, workDays: [0,1,2,3,4] });
            const allMessages = Object.values(cfg.messages).join(' ');
            expect(allMessages).toMatch(/[א-ת]/);
        });
    });

    describe('createLocalizer — weekStartDay', () => {
        it('weekStartDay=0 → ראשון תחילת שבוע', () => {
            const loc = createLocalizer({ language: 'he', weekStartDay: 0 });
            // date-fns startOfWeek מוודא — יום 2026-05-04 הוא יום שני, התחלת שבוע צריכה להיות 2026-05-03 (ראשון)
            const monday = new Date(2026, 4, 4);
            const start = loc.customStartOfWeek(monday);
            expect(start.getDay()).toBe(0);
        });

        it('weekStartDay=1 → שני תחילת שבוע (ארה"ב/אירופה)', () => {
            const loc = createLocalizer({ language: 'en', weekStartDay: 1 });
            const wed = new Date(2026, 4, 6);
            const start = loc.customStartOfWeek(wed);
            expect(start.getDay()).toBe(1);
        });
    });

    describe('createMessages — שלמות מפתחות', () => {
        const REQUIRED_KEYS = [
            'today', 'previous', 'next', 'month', 'week', 'day',
            'agenda', 'date', 'time', 'event', 'noEventsInRange', 'allDay'
        ];

        it('he מכיל את כל המפתחות הנדרשים של react-big-calendar', () => {
            const m = createMessages('he');
            for (const key of REQUIRED_KEYS) {
                expect(m, `missing key: ${key}`).toHaveProperty(key);
                expect(m[key]).toBeTruthy();
            }
        });

        it('en מכיל את אותם מפתחות בדיוק', () => {
            const he = createMessages('he');
            const en = createMessages('en');
            expect(Object.keys(en).sort()).toEqual(Object.keys(he).sort());
        });
    });

    describe('formats — תלות locale', () => {
        it('he מפיק שמות חודשים בעברית', () => {
            const cfg = createCalendarConfig({ language: 'he', weekStartDay: 0, workDays: [0,1,2,3,4] });
            const formatted = cfg.formats.monthHeaderFormat(new Date(2026, 4, 4));
            expect(formatted).toMatch(/[א-ת]/);
        });

        it('en מפיק שמות חודשים באנגלית', () => {
            const cfg = createCalendarConfig({ language: 'en', weekStartDay: 0, workDays: [0,1,2,3,4] });
            const formatted = cfg.formats.monthHeaderFormat(new Date(2026, 4, 4));
            expect(formatted).toMatch(/may/i);
        });
    });

    describe('עקביות — אותם פרמטרים מייצרים אותו פלט', () => {
        it('שתי קריאות עם אותם args → messages זהים', () => {
            const a = createCalendarConfig({ language: 'he', weekStartDay: 0, workDays: [0,1,2,3,4] });
            const b = createCalendarConfig({ language: 'he', weekStartDay: 0, workDays: [0,1,2,3,4] });
            expect(a.messages).toEqual(b.messages);
        });
    });
});
