import { describe, it, expect } from 'vitest';
import {
    toMondayDateFormat,
    toMondayTimeFormat,
    toMondayDateTimeColumn,
    toLocalDateFormat,
    toLocalTimeFormat
} from '../dateFormatters';

describe('dateFormatters', () => {

    // === toMondayDateFormat ===

    describe('toMondayDateFormat', () => {
        it('מפורמט תאריך לפורמט YYYY-MM-DD (UTC)', () => {
            const date = new Date(Date.UTC(2026, 1, 15)); // Feb 15, 2026
            expect(toMondayDateFormat(date)).toBe('2026-02-15');
        });

        it('מוסיף padding לחודש ויום חד-ספרתיים', () => {
            const date = new Date(Date.UTC(2026, 0, 5)); // Jan 5, 2026
            expect(toMondayDateFormat(date)).toBe('2026-01-05');
        });

        it('מטפל בסוף שנה', () => {
            const date = new Date(Date.UTC(2025, 11, 31)); // Dec 31, 2025
            expect(toMondayDateFormat(date)).toBe('2025-12-31');
        });

        it('מטפל בתחילת שנה', () => {
            const date = new Date(Date.UTC(2026, 0, 1)); // Jan 1, 2026
            expect(toMondayDateFormat(date)).toBe('2026-01-01');
        });

        it('זורק על Invalid Date (גבול כתיבה — לא בולע בשקט)', () => {
            expect(() => toMondayDateFormat(new Date('invalid'))).toThrow();
        });

        it('זורק על קלט שאינו Date', () => {
            expect(() => toMondayDateFormat(null)).toThrow();
            expect(() => toMondayDateFormat(undefined)).toThrow();
        });

        it('לא משנה את הפלט על קלט תקין (זהה לחלוטין)', () => {
            const date = new Date(Date.UTC(2026, 1, 15)); // Feb 15, 2026
            expect(toMondayDateFormat(date)).toBe('2026-02-15');
        });
    });

    // === toMondayTimeFormat ===

    describe('toMondayTimeFormat', () => {
        it('מפורמט שעה לפורמט HH:MM:SS (UTC)', () => {
            const date = new Date(Date.UTC(2026, 1, 15, 14, 30, 45));
            expect(toMondayTimeFormat(date)).toBe('14:30:45');
        });

        it('מוסיף padding לשעה/דקות/שניות חד-ספרתיות', () => {
            const date = new Date(Date.UTC(2026, 1, 15, 9, 5, 3));
            expect(toMondayTimeFormat(date)).toBe('09:05:03');
        });

        it('מטפל בחצות', () => {
            const date = new Date(Date.UTC(2026, 1, 15, 0, 0, 0));
            expect(toMondayTimeFormat(date)).toBe('00:00:00');
        });

        it('מטפל ב-23:59:59', () => {
            const date = new Date(Date.UTC(2026, 1, 15, 23, 59, 59));
            expect(toMondayTimeFormat(date)).toBe('23:59:59');
        });

        it('זורק על Invalid Date (גבול כתיבה — לא בולע בשקט)', () => {
            expect(() => toMondayTimeFormat(new Date('invalid'))).toThrow();
        });

        it('זורק על קלט שאינו Date', () => {
            expect(() => toMondayTimeFormat(null)).toThrow();
            expect(() => toMondayTimeFormat(undefined)).toThrow();
        });

        it('לא משנה את הפלט על קלט תקין (זהה לחלוטין)', () => {
            const date = new Date(Date.UTC(2026, 1, 15, 14, 30, 45));
            expect(toMondayTimeFormat(date)).toBe('14:30:45');
        });
    });

    // === toMondayDateTimeColumn ===

    describe('toMondayDateTimeColumn', () => {
        it('מחזיר אובייקט עם date ו-time', () => {
            const date = new Date(Date.UTC(2026, 1, 15, 10, 30, 0));
            const result = toMondayDateTimeColumn(date);
            expect(result).toEqual({
                date: '2026-02-15',
                time: '10:30:00'
            });
        });

        it('זורק על Invalid Date (גבול כתיבה — לא בולע בשקט)', () => {
            expect(() => toMondayDateTimeColumn(new Date('invalid'))).toThrow();
        });

        it('זורק על קלט שאינו Date', () => {
            expect(() => toMondayDateTimeColumn(null)).toThrow();
            expect(() => toMondayDateTimeColumn(undefined)).toThrow();
        });

        it('לא משנה את הפלט על קלט תקין (זהה לחלוטין)', () => {
            const date = new Date(Date.UTC(2026, 1, 15, 10, 30, 0));
            expect(toMondayDateTimeColumn(date)).toEqual({
                date: '2026-02-15',
                time: '10:30:00'
            });
        });
    });

    // === toLocalDateFormat ===

    describe('toLocalDateFormat', () => {
        it('מפורמט תאריך בזמן מקומי', () => {
            const date = new Date(2026, 1, 15); // Feb 15, 2026 local
            expect(toLocalDateFormat(date)).toBe('2026-02-15');
        });

        it('מוסיף padding לחודש ויום חד-ספרתיים', () => {
            const date = new Date(2026, 0, 5); // Jan 5, 2026 local
            expect(toLocalDateFormat(date)).toBe('2026-01-05');
        });
    });

    // === toLocalTimeFormat ===

    describe('toLocalTimeFormat', () => {
        it('מפורמט שעה בפורמט HH:MM (ללא שניות)', () => {
            const date = new Date(2026, 1, 15, 14, 30);
            expect(toLocalTimeFormat(date)).toBe('14:30');
        });

        it('מוסיף padding', () => {
            const date = new Date(2026, 1, 15, 9, 5);
            expect(toLocalTimeFormat(date)).toBe('09:05');
        });

        it('מטפל בחצות', () => {
            const date = new Date(2026, 1, 15, 0, 0);
            expect(toLocalTimeFormat(date)).toBe('00:00');
        });
    });
});
