import { describe, it, expect } from 'vitest';
import {
    isAllDayEventType,
    calculateDaysDiff,
    calculateEndDateFromDays,
    parseDuration,
    formatDurationForSave
} from '../durationUtils';

// מיפוי לדוגמה לשימוש בבדיקות
// (אחרי הרפקטור: ALL_DAY הוא לייבל יחיד; התת-סוגים בעמודת status נפרדת)
const MOCK_MAPPING = {
    '3': 'billable',
    '0': 'allDay',    // יומי
    '101': 'nonBillable'
};

describe('durationUtils', () => {

    // === isAllDayEventType ===

    describe('isAllDayEventType', () => {
        it('מזהה אינדקס allDay עם mapping', () => {
            expect(isAllDayEventType('0', MOCK_MAPPING)).toBe(true);
        });

        it('מחזיר false עבור אינדקס שעתי עם mapping', () => {
            expect(isAllDayEventType('3', MOCK_MAPPING)).toBe(false);
            expect(isAllDayEventType('101', MOCK_MAPPING)).toBe(false);
        });

        it('מחזיר false ללא mapping', () => {
            expect(isAllDayEventType('0')).toBe(false);
        });
    });

    // === calculateDaysDiff ===

    describe('calculateDaysDiff', () => {
        it('מחזיר מינימום 1 עבור אותו תאריך', () => {
            const date = new Date(2026, 1, 15);
            expect(calculateDaysDiff(date, date)).toBe(1);
        });

        it('מחשב הפרש של 3 ימים', () => {
            const start = new Date(2026, 1, 10);
            const end = new Date(2026, 1, 13);
            expect(calculateDaysDiff(start, end)).toBe(3);
        });

        it('מחשב הפרש של יום אחד', () => {
            const start = new Date(2026, 1, 15);
            const end = new Date(2026, 1, 16);
            expect(calculateDaysDiff(start, end)).toBe(1);
        });

        it('מטפל ב-end לפני start (ערך מוחלט)', () => {
            const start = new Date(2026, 1, 15);
            const end = new Date(2026, 1, 10);
            expect(calculateDaysDiff(start, end)).toBe(5);
        });

        it('מטפל בשינוי חודש', () => {
            const start = new Date(2026, 0, 30);
            const end = new Date(2026, 1, 2);
            expect(calculateDaysDiff(start, end)).toBe(3);
        });

        it('מטפל בשינוי שנה', () => {
            const start = new Date(2025, 11, 30);
            const end = new Date(2026, 0, 2);
            expect(calculateDaysDiff(start, end)).toBe(3);
        });
    });

    // === calculateEndDateFromDays ===

    describe('calculateEndDateFromDays', () => {
        it('מחשב תאריך סיום ליום אחד (exclusive)', () => {
            const start = new Date(2026, 1, 15);
            const end = calculateEndDateFromDays(start, 1);
            expect(end.getDate()).toBe(16);
            expect(end.getHours()).toBe(0);
            expect(end.getMinutes()).toBe(0);
        });

        it('מחשב תאריך סיום ל-3 ימים', () => {
            const start = new Date(2026, 1, 15);
            const end = calculateEndDateFromDays(start, 3);
            expect(end.getDate()).toBe(18);
        });

        it('מגביל מינימום ליום אחד (durationDays=0)', () => {
            const start = new Date(2026, 1, 15);
            const end = calculateEndDateFromDays(start, 0);
            expect(end.getDate()).toBe(16); // Math.max(1, 0) = 1
        });

        it('מגביל מינימום ליום אחד (durationDays שלילי)', () => {
            const start = new Date(2026, 1, 15);
            const end = calculateEndDateFromDays(start, -3);
            expect(end.getDate()).toBe(16); // Math.max(1, -3) = 1
        });

        it('מאפס שעות לחצות', () => {
            const start = new Date(2026, 1, 15, 14, 30, 0);
            const end = calculateEndDateFromDays(start, 2);
            expect(end.getHours()).toBe(0);
            expect(end.getMinutes()).toBe(0);
            expect(end.getSeconds()).toBe(0);
        });

        it('לא משנה את תאריך ההתחלה המקורי', () => {
            const start = new Date(2026, 1, 15, 10, 0, 0);
            const originalTime = start.getTime();
            calculateEndDateFromDays(start, 5);
            expect(start.getTime()).toBe(originalTime);
        });
    });

    // === parseDuration ===

    describe('parseDuration', () => {
        it('מפרסר שעות עבור אירוע שעתי', () => {
            const result = parseDuration(2.5, '3', MOCK_MAPPING);
            expect(result).toEqual({ value: 2.5, unit: 'hours' });
        });

        it('מפרסר ימים עבור אירוע יומי', () => {
            const result = parseDuration(3, '0', MOCK_MAPPING);
            expect(result).toEqual({ value: 3, unit: 'days' });
        });

        it('ממיר 0 ימים ל-1 (מינימום)', () => {
            const result = parseDuration(0, '0', MOCK_MAPPING);
            expect(result).toEqual({ value: 1, unit: 'days' });
        });

        it('מעגל ימים למספר שלם', () => {
            const result = parseDuration(2.7, '0', MOCK_MAPPING);
            expect(result).toEqual({ value: 3, unit: 'days' });
        });

        it('מטפל במחרוזת כקלט', () => {
            const result = parseDuration('4.5', '3', MOCK_MAPPING);
            expect(result).toEqual({ value: 4.5, unit: 'hours' });
        });

        it('מחזיר 0 עבור ערך לא תקין (שעתי)', () => {
            const result = parseDuration('abc', '3', MOCK_MAPPING);
            expect(result).toEqual({ value: 0, unit: 'hours' });
        });

        it('מחזיר 1 עבור ערך לא תקין (יומי)', () => {
            const result = parseDuration('abc', '0', MOCK_MAPPING);
            expect(result).toEqual({ value: 1, unit: 'days' });
        });

        it('מטפל ב-null/undefined', () => {
            const result = parseDuration(null, '3', MOCK_MAPPING);
            expect(result).toEqual({ value: 0, unit: 'hours' });
        });

        it('ללא mapping - תמיד שעות', () => {
            const result = parseDuration(5, 'חופשה');
            expect(result).toEqual({ value: 5, unit: 'hours' });
        });
    });

    // === formatDurationForSave ===

    describe('formatDurationForSave', () => {
        it('מפורמט שעות כעשרוני', () => {
            expect(formatDurationForSave(2.5, '3', MOCK_MAPPING)).toBe('2.50');
        });

        it('מפורמט ימים כמספר שלם', () => {
            expect(formatDurationForSave(3, '0', MOCK_MAPPING)).toBe('3');
        });

        it('מעגל ימים עשרוניים', () => {
            expect(formatDurationForSave(2.7, '0', MOCK_MAPPING)).toBe('3');
        });

        it('מגביל מינימום 1 יום', () => {
            expect(formatDurationForSave(0, '0', MOCK_MAPPING)).toBe('1');
        });

        it('מפורמט 0 שעות', () => {
            expect(formatDurationForSave(0, '3', MOCK_MAPPING)).toBe('0.00');
        });

        it('מפורמט שעות שלמות עם שני מקומות עשרוניים', () => {
            expect(formatDurationForSave(8, '3', MOCK_MAPPING)).toBe('8.00');
        });
    });
});
