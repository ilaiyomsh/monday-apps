import { describe, it, expect } from 'vitest';
import {
    extractStrings,
    assertNoForbiddenStrings,
    detectStatusColumnShape,
    findStatusColumnWrites
} from '../payloadGuard';

describe('payloadGuard (Phase 2a)', () => {

    describe('extractStrings', () => {
        it('מחזיר את כל המחרוזות באובייקט שטוח', () => {
            expect(extractStrings({ a: 'x', b: 'y' })).toEqual(['x', 'y']);
        });

        it('עובר רקורסיבית על אובייקטים מקוננים', () => {
            const result = extractStrings({ a: { b: { c: 'deep' } } });
            expect(result).toEqual(['deep']);
        });

        it('מחלץ מחרוזות מתוך מערכים', () => {
            const result = extractStrings({ items: ['a', 'b', { x: 'c' }] });
            expect(result).toEqual(['a', 'b', 'c']);
        });

        it('מתעלם ממספרים, null ו-undefined', () => {
            expect(extractStrings({ a: 1, b: null, c: undefined, d: 'x' }))
                .toEqual(['x']);
        });
    });

    describe('assertNoForbiddenStrings', () => {
        it('עובר כשאין התאמה', () => {
            const payload = { a: 'safe', b: { c: 'also safe' } };
            expect(() => assertNoForbiddenStrings(payload, ['Hourly', 'שעתי']))
                .not.toThrow();
        });

        it('זורק כשערך זהה למחרוזת אסורה', () => {
            const payload = { eventType: 'שעתי' };
            expect(() => assertNoForbiddenStrings(payload, ['שעתי']))
                .toThrow(/leaked/i);
        });

        it('זורק כשערך מכיל מחרוזת אסורה כתת-מחרוזת', () => {
            const payload = { msg: 'Status: Hourly report' };
            expect(() => assertNoForbiddenStrings(payload, ['Hourly']))
                .toThrow();
        });

        it('הודעת השגיאה כוללת path מדויק', () => {
            const payload = { col: { sub: { value: 'BAD' } } };
            expect(() => assertNoForbiddenStrings(payload, ['BAD']))
                .toThrow(/col\.sub\.value/);
        });

        it('עובר על מערכים — תופס גם בתוכם', () => {
            const payload = { items: [{ label: 'translated' }] };
            expect(() => assertNoForbiddenStrings(payload, ['translated']))
                .toThrow();
        });

        it('allowedKeys — מתעלם ממחרוזות בשדות שהוגדרו כמותרים', () => {
            const payload = { notes: 'שעתי כתבתי בהערה', label: 'safe' };
            expect(() => assertNoForbiddenStrings(payload, ['שעתי'], { allowedKeys: ['notes'] }))
                .not.toThrow();
        });

        it('allowedKeys לא משחרר שדות אחרים', () => {
            const payload = { notes: 'שעתי', column: { label: 'שעתי' } };
            expect(() => assertNoForbiddenStrings(payload, ['שעתי'], { allowedKeys: ['notes'] }))
                .toThrow(/column\.label/);
        });
    });

    describe('detectStatusColumnShape', () => {
        it('מזהה {index: number} כ-"index"', () => {
            expect(detectStatusColumnShape({ index: 3 })).toBe('index');
            expect(detectStatusColumnShape({ index: 0 })).toBe('index');
        });

        it('מזהה {label: string} כ-"label"', () => {
            expect(detectStatusColumnShape({ label: 'שעתי' })).toBe('label');
        });

        it('מחזיר null לערכים שאינם status', () => {
            expect(detectStatusColumnShape({ date: '2026-05-04' })).toBeNull();
            expect(detectStatusColumnShape({ item_ids: [1] })).toBeNull();
            expect(detectStatusColumnShape('plain string')).toBeNull();
            expect(detectStatusColumnShape(null)).toBeNull();
            expect(detectStatusColumnShape(42)).toBeNull();
        });

        it('index שאינו מספר לא נחשב index', () => {
            expect(detectStatusColumnShape({ index: '3' })).toBeNull();
        });
    });

    describe('findStatusColumnWrites', () => {
        it('מחזיר רשימת כל הכתיבות לעמודות סטטוס בתוך column_values', () => {
            const cv = {
                date_col: { date: '2026-05-04', time: '10:00:00' },
                event_type: { index: 3 },
                stage: { label: 'Phase 1' },
                duration: '2.50',
                project_link: { item_ids: [123] }
            };
            const writes = findStatusColumnWrites(cv);
            expect(writes).toHaveLength(2);
            expect(writes).toContainEqual({ columnId: 'event_type', shape: 'index', value: { index: 3 } });
            expect(writes).toContainEqual({ columnId: 'stage', shape: 'label', value: { label: 'Phase 1' } });
        });

        it('מחזיר מערך ריק כשאין status writes', () => {
            const cv = { date_col: { date: '2026-05-04', time: '10:00:00' }, duration: '2.50' };
            expect(findStatusColumnWrites(cv)).toEqual([]);
        });

        it('מטפל בקלט לא תקני בלי לקרוס', () => {
            expect(findStatusColumnWrites(null)).toEqual([]);
            expect(findStatusColumnWrites(undefined)).toEqual([]);
            expect(findStatusColumnWrites('string')).toEqual([]);
        });
    });
});
