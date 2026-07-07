import { describe, it, expect } from 'vitest';

// TDD: בדיקה הכי קריטית בפרויקט (Increment 3-4).
// המודול הזה מבטיח שכתיבות לעמודות סטטוס ב-Monday משתמשות ב-IDs / index בלבד —
// לעולם לא ב-טקסט מתורגם. זה החסם שמונע "שבירת" נתוני לוח כשמחליפים שפה.
//
// המודול columnValueBuilders עוד לא קיים — הטסטים מגדירים את החוזה.
import {
    buildStatusColumnValue,
    buildEventTypeColumnValue,
    assertNoTranslatedLabels
} from '../columnValueBuilders';

const SAMPLE_MAPPING = {
    '0': 'allDay',         // חופשה
    '2': 'allDay',         // מחלה
    '3': 'billable',       // שעתי
    '5': 'temporary',      // זמני
    '6': 'allDay',         // מילואים
    '101': 'nonBillable'   // לא לחיוב
};

describe('Status Label Preservation (Increment 3-4) — חוזה קריטי', () => {

    describe('buildStatusColumnValue', () => {
        it('מחזיר { index: N } — לעולם לא טקסט', () => {
            const value = buildStatusColumnValue(3);
            expect(value).toEqual({ index: 3 });
            expect(value).not.toHaveProperty('label');
            expect(value).not.toHaveProperty('text');
        });

        it('זורק שגיאה אם מקבלים טקסט במקום מספר', () => {
            expect(() => buildStatusColumnValue('שעתי')).toThrow();
            expect(() => buildStatusColumnValue('Hourly')).toThrow();
        });

        it('זורק שגיאה אם index הוא NaN/undefined', () => {
            expect(() => buildStatusColumnValue(undefined)).toThrow();
            expect(() => buildStatusColumnValue(NaN)).toThrow();
        });
    });

    describe('buildEventTypeColumnValue — פתרון קטגוריה ל-index', () => {
        it('billable מתורגם ל-index לפי המיפוי', () => {
            const value = buildEventTypeColumnValue('billable', SAMPLE_MAPPING);
            expect(value).toEqual({ index: 3 });
        });

        it('temporary מתורגם ל-5', () => {
            expect(buildEventTypeColumnValue('temporary', SAMPLE_MAPPING))
                .toEqual({ index: 5 });
        });

        it('allDay (חופשה) — בוחר את ה-index הראשון של הקטגוריה הספציפית כשמסופק', () => {
            const value = buildEventTypeColumnValue('allDay', SAMPLE_MAPPING, { specificIndex: 6 });
            expect(value).toEqual({ index: 6 });
        });

        it('זורק שגיאה אם הקטגוריה לא קיימת במיפוי', () => {
            expect(() => buildEventTypeColumnValue('billable', {}))
                .toThrow(/mapping/i);
        });

        it('payload לא מכיל לעולם את הטקסט המתורגם', () => {
            const value = buildEventTypeColumnValue('billable', SAMPLE_MAPPING);
            const json = JSON.stringify(value);
            expect(json).not.toMatch(/שעתי|Hourly|חופשה|Vacation/);
        });
    });

    describe('assertNoTranslatedLabels — שומר בכניסה ל-API', () => {
        it('עובר על payload חוקי עם indexes', () => {
            const payload = {
                event_type_col: { index: 3 },
                non_billable_col: { index: 101 }
            };
            expect(() => assertNoTranslatedLabels(payload)).not.toThrow();
        });

        it('זורק על payload עם label עברי', () => {
            const payload = { event_type_col: { label: 'שעתי' } };
            expect(() => assertNoTranslatedLabels(payload)).toThrow(/translated|label/i);
        });

        it('זורק על payload עם label אנגלי', () => {
            const payload = { event_type_col: { label: 'Hourly' } };
            expect(() => assertNoTranslatedLabels(payload)).toThrow();
        });

        it('זורק כשיש שדה text במקום index', () => {
            const payload = { event_type_col: { text: 'שעתי' } };
            expect(() => assertNoTranslatedLabels(payload)).toThrow();
        });

        it('בודק רקורסיבית גם במבנים מקוננים', () => {
            const payload = {
                wrapper: {
                    nested: { event_type_col: { label: 'Vacation' } }
                }
            };
            expect(() => assertNoTranslatedLabels(payload)).toThrow();
        });
    });

    describe('עקביות עם החלפת שפה', () => {
        it('שינוי שפת UI לא משנה את ה-index שנשלח לעמודת סטטוס', () => {
            const heValue = buildEventTypeColumnValue('billable', SAMPLE_MAPPING);
            // גם אם ה-UI מציג את הלייבל באנגלית, ה-index הוא אותו index.
            const enValue = buildEventTypeColumnValue('billable', SAMPLE_MAPPING);
            expect(heValue).toEqual(enValue);
        });
    });
});
