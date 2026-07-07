import { describe, it, expect } from 'vitest';
import {
    getContrastColor,
    ensureDarkEnough,
    stringToColor,
    EVENT_TYPE_COLORS,
    getEventColor
} from '../colorUtils';

describe('colorUtils', () => {

    // === getContrastColor ===

    describe('getContrastColor', () => {
        it('מחזיר שחור עבור רקע לבן', () => {
            expect(getContrastColor('#ffffff')).toBe('#000000');
        });

        it('מחזיר לבן עבור רקע שחור', () => {
            expect(getContrastColor('#000000')).toBe('#ffffff');
        });

        it('מחזיר לבן עבור רקע כהה', () => {
            expect(getContrastColor('#333333')).toBe('#ffffff');
        });

        it('מחזיר שחור עבור רקע בהיר (צהוב)', () => {
            expect(getContrastColor('#ffff00')).toBe('#000000');
        });

        it('מטפל בצבע ללא #', () => {
            expect(getContrastColor('ffffff')).toBe('#000000');
        });

        it('מחזיר לבן עבור ערך ריק', () => {
            expect(getContrastColor('')).toBe('#ffffff');
        });

        it('מחזיר לבן עבור null', () => {
            expect(getContrastColor(null)).toBe('#ffffff');
        });

        it('מחזיר לבן עבור undefined', () => {
            expect(getContrastColor(undefined)).toBe('#ffffff');
        });
    });

    // === ensureDarkEnough ===

    describe('ensureDarkEnough', () => {
        it('לא משנה צבע כהה מספיק', () => {
            const darkColor = '#333333';
            expect(ensureDarkEnough(darkColor)).toBe(darkColor);
        });

        it('מחשיך צבע בהיר מדי', () => {
            const result = ensureDarkEnough('#ffffff');
            // הצבע צריך להיות כהה יותר מלבן
            expect(result).not.toBe('#ffffff');
        });

        it('מחזיר צבע ברירת מחדל עבור null', () => {
            expect(ensureDarkEnough(null)).toBe('#579bfc');
        });

        it('מחזיר צבע ברירת מחדל עבור מחרוזת ריקה', () => {
            expect(ensureDarkEnough('')).toBe('#579bfc');
        });

        it('מטפל ב-hex מקוצר (3 תווים)', () => {
            const result = ensureDarkEnough('#fff');
            expect(result).not.toBe('#ffffff');
            // צבע תקין בפורמט hex
            expect(result).toMatch(/^#[0-9a-f]{6}$/);
        });

        it('מכבד threshold מותאם אישית', () => {
            // עם threshold גבוה, אפילו צבעים "רגילים" יוחשכו
            const result = ensureDarkEnough('#888888', 50);
            expect(result).not.toBe('#888888');
        });
    });

    // === stringToColor ===

    describe('stringToColor', () => {
        it('מחזיר צבע ברירת מחדל עבור ערך ריק', () => {
            expect(stringToColor('')).toBe('#579bfc');
            expect(stringToColor(null)).toBe('#579bfc');
            expect(stringToColor(undefined)).toBe('#579bfc');
        });

        it('מחזיר צבע עקבי לאותו קלט', () => {
            const color1 = stringToColor('project-123');
            const color2 = stringToColor('project-123');
            expect(color1).toBe(color2);
        });

        it('מחזיר צבעים שונים לקלטים שונים', () => {
            // רוב הסיכויים שיהיו שונים (לא מובטח ב-100%)
            // נבדוק שהפונקציה לא מחזירה תמיד אותו דבר
            const colors = new Set(
                ['a', 'b', 'c', 'd', 'e'].map(s => stringToColor(s))
            );
            expect(colors.size).toBeGreaterThan(1);
        });

        it('מחזיר צבע בפורמט hex תקין', () => {
            const color = stringToColor('test-project');
            expect(color).toMatch(/^#[0-9a-f]{6}$/);
        });
    });

    // === EVENT_TYPE_COLORS ===

    describe('EVENT_TYPE_COLORS', () => {
        it('מכיל צבעים לכל סוגי האירועים היומיים', () => {
            expect(EVENT_TYPE_COLORS['חופשה']).toBeDefined();
            expect(EVENT_TYPE_COLORS['מחלה']).toBeDefined();
            expect(EVENT_TYPE_COLORS['מילואים']).toBeDefined();
        });
    });

    // === getEventColor ===

    describe('getEventColor', () => {
        it('מחזיר צבע לפי eventTypeColor עבור allDay', () => {
            const color = getEventColor('חופשה', null, '#fdab3d', true);
            expect(color).toBeDefined();
            expect(color).toMatch(/^#[0-9a-f]{6}$/);
        });

        it('fallback ל-EVENT_TYPE_COLORS עבור allDay ללא eventTypeColor', () => {
            const color = getEventColor('חופשה', null, null, true);
            expect(color).toBeDefined();
        });

        it('מחזיר צבע לפי projectId עבור אירוע שעתי', () => {
            const color = getEventColor('שעתי', '123', null, false);
            expect(color).toMatch(/^#[0-9a-f]{6}$/);
        });

        it('צבע עקבי לאותו projectId', () => {
            const color1 = getEventColor('שעתי', '123', null, false);
            const color2 = getEventColor('שעתי', '123', null, false);
            expect(color1).toBe(color2);
        });

        it('fallback ל-eventTypeColor אם אין projectId', () => {
            const color = getEventColor('שעתי', null, '#ff0000', false);
            expect(color).toBeDefined();
        });

        it('מחזיר צבע ברירת מחדל כשאין שום מידע', () => {
            const color = getEventColor(null, null, null, false);
            expect(color).toBeDefined();
            expect(color).toMatch(/^#[0-9a-f]{6}$/);
        });
    });
});
