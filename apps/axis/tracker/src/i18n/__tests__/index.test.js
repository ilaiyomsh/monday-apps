import { describe, it, expect, beforeEach } from 'vitest';

// TDD: המודול הזה עדיין לא קיים — יישום בא עם Increment 1.
// הטסט מאמת את החוזה לפני שהקוד נכתב.
import i18n, { resolveLanguage, t, SUPPORTED_LANGUAGES } from '../index';

describe('i18n foundation (Increment 1)', () => {

    describe('initialization', () => {
        it('מאותחל עם fallbackLng = "he"', () => {
            expect(i18n.options.fallbackLng).toEqual(expect.arrayContaining(['he']));
        });

        it('תומך ב-he ו-en בלבד', () => {
            expect(SUPPORTED_LANGUAGES).toEqual(['he', 'en']);
        });

        it('מתחיל בעברית כברירת מחדל', () => {
            expect(i18n.language).toBe('he');
        });

        it('מחזיר את העברית כשמפתח חסר באנגלית (fallback)', async () => {
            await i18n.changeLanguage('en');
            // מפתח שלא קיים — i18next אמור ליפול חזרה לעברית
            const value = t('this.key.does.not.exist.in.either');
            expect(typeof value).toBe('string');
        });
    });

    describe('resolveLanguage — שרשרת רזולוציה', () => {
        it('עדיפות ראשונה: settings.languageOverride', () => {
            const lang = resolveLanguage(
                { languageOverride: 'en' },
                { user: { currentLanguage: 'he' } }
            );
            expect(lang).toBe('en');
        });

        it('אם אין override, נופל ל-monday.context.user.currentLanguage', () => {
            const lang = resolveLanguage(
                { languageOverride: null },
                { user: { currentLanguage: 'en' } }
            );
            expect(lang).toBe('en');
        });

        it('אם אין override ואין currentLanguage — נופל ל-"he"', () => {
            const lang = resolveLanguage({}, {});
            expect(lang).toBe('he');
        });

        it('אם הקונטקסט null — נופל ל-"he"', () => {
            expect(resolveLanguage({}, null)).toBe('he');
        });

        it('שפה לא נתמכת מ-currentLanguage — נופלת ל-"he"', () => {
            const lang = resolveLanguage({}, { user: { currentLanguage: 'fr' } });
            expect(lang).toBe('he');
        });

        it('שפה לא נתמכת ב-override — נזרקת שגיאה (ולידציה מפורשת בהגדרות)', () => {
            expect(() => resolveLanguage({ languageOverride: 'de' }, {}))
                .toThrow(/unsupported/i);
        });
    });

    describe('t() — בעברית', () => {
        beforeEach(async () => {
            await i18n.changeLanguage('he');
        });

        it('מחזיר טקסט עברי למפתח קיים', () => {
            expect(t('common.save')).toMatch(/[א-ת]/);
        });
    });

    describe('t() — באנגלית', () => {
        beforeEach(async () => {
            await i18n.changeLanguage('en');
        });

        it('מחזיר טקסט באנגלית למפתח קיים', () => {
            const value = t('common.save');
            expect(value).toBeTruthy();
            expect(value).not.toMatch(/[א-ת]/);
        });
    });
});
