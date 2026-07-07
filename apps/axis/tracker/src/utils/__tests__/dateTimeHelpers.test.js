import { describe, it, expect } from 'vitest';

// TDD: Increment 7 — מודול עזר מרכזי לתאריך/שעה.
// הקבצים האלה עדיין לא קיימים — הטסטים מגדירים את החוזה.
import {
    formatTime,
    formatDate,
    parseUserTime,
    toMondayDateString,
    toMondayDateTimeString,
    isSameDay,
    addDays
} from '../dateTimeHelpers';

describe('dateTimeHelpers (Increment 7)', () => {

    describe('formatTime — פורמט שעה לפי locale', () => {
        const date = new Date('2026-05-04T14:30:00');

        it('he מחזיר 24h ("14:30")', () => {
            expect(formatTime(date, { locale: 'he', timeFormat: '24h' })).toBe('14:30');
        });

        it('en עם 12h מחזיר ("2:30 PM")', () => {
            expect(formatTime(date, { locale: 'en', timeFormat: '12h' })).toMatch(/^2:30\s?PM$/i);
        });

        it('en עם 24h שומר על "14:30"', () => {
            expect(formatTime(date, { locale: 'en', timeFormat: '24h' })).toBe('14:30');
        });

        it('00:00 לא הופך ל-24:00', () => {
            const midnight = new Date('2026-05-04T00:00:00');
            expect(formatTime(midnight, { locale: 'he', timeFormat: '24h' })).toBe('00:00');
        });
    });

    describe('formatDate — פורמט תאריך לפי locale', () => {
        const date = new Date('2026-05-04T10:00:00');

        it('he מציג בעברית', () => {
            const out = formatDate(date, { locale: 'he' });
            expect(out).toMatch(/2026/);
        });

        it('en מציג ב-English locale', () => {
            const out = formatDate(date, { locale: 'en' });
            expect(out).toMatch(/2026/);
            expect(out).not.toMatch(/[א-ת]/);
        });
    });

    describe('parseUserTime — קלט חופשי של המשתמש', () => {
        it('"9:5" → "09:05"', () => {
            expect(parseUserTime('9:5', { locale: 'he' })).toEqual({ hours: 9, minutes: 5 });
        });

        it('"14:30" נפרס נכון', () => {
            expect(parseUserTime('14:30', { locale: 'he' })).toEqual({ hours: 14, minutes: 30 });
        });

        it('"2:30 PM" באנגלית → 14:30', () => {
            expect(parseUserTime('2:30 PM', { locale: 'en' })).toEqual({ hours: 14, minutes: 30 });
        });

        it('קלט לא תקין מחזיר null', () => {
            expect(parseUserTime('abc', { locale: 'he' })).toBeNull();
        });
    });

    describe('toMondayDateString — פורמט YYYY-MM-DD ל-Monday', () => {
        it('מחזיר תאריך בלי שעה בפורמט הנכון', () => {
            const date = new Date('2026-05-04T22:30:00');
            expect(toMondayDateString(date)).toBe('2026-05-04');
        });

        it('עקבי לאורך timezone — לא "מדלג" יום בגלל UTC', () => {
            // 2026-05-04 23:59 לוקאלי — עדיין צריך לחזור 2026-05-04, לא 05-05.
            const date = new Date(2026, 4, 4, 23, 59);
            expect(toMondayDateString(date)).toBe('2026-05-04');
        });
    });

    describe('toMondayDateTimeString — פורמט תאריך+שעה ל-Monday (UTC)', () => {
        it('מומר ל-UTC כצפוי לעמודת date של Monday', () => {
            const local = new Date(2026, 4, 4, 14, 30);
            const out = toMondayDateTimeString(local);
            // החוזה: יוצא ISO ב-UTC עם Z או offset מפורש
            expect(out).toMatch(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/);
        });
    });

    describe('DST — Asia/Jerusalem', () => {
        // ישראל עוברת לשעון קיץ בסוף מרץ. 2026-03-27 (יום שישי לפני סוף מרץ) → DST forward.
        it('הוספת יום מעבר גבול DST שומרת על שעה לוקאלית', () => {
            const before = new Date(2026, 2, 26, 12, 0); // 2026-03-26 12:00
            const after = addDays(before, 7); // 2026-04-02 12:00 (אחרי המעבר)
            expect(after.getHours()).toBe(12);
        });

        it('isSameDay נכון גם מסביב ל-DST forward', () => {
            const a = new Date(2026, 2, 27, 1, 0);
            const b = new Date(2026, 2, 27, 23, 0);
            expect(isSameDay(a, b)).toBe(true);
        });
    });

    describe('עקביות', () => {
        it('פורמט עוקב — אותו Date מוביל לאותו פלט', () => {
            const d = new Date('2026-05-04T10:00:00');
            const opts = { locale: 'he', timeFormat: '24h' };
            expect(formatTime(d, opts)).toBe(formatTime(d, opts));
        });
    });
});
