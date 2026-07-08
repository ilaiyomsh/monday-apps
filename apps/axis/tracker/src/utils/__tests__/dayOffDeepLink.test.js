import { describe, it, expect } from 'vitest';
import { buildDayOffDeepLink } from '../dayOffDeepLink';

describe('buildDayOffDeepLink', () => {
    const BASE = 'https://yomsheni-il.monday.com/custom_objects/18417140187';

    it('בונה את הקישור בפורמט app[itemId] (סוגריים מקודדים %5B/%5D, ש-monday מפענחת)', () => {
        const link = buildDayOffDeepLink(BASE, 1234567890);
        // URL.searchParams מקודד את הסוגריים; שתי הצורות תקינות מול monday
        expect(link).toBe(`${BASE}?app%5BitemId%5D=1234567890`);
        // הפרמטר אכן נקרא חזרה כ-app[itemId]
        expect(new URL(link).searchParams.get('app[itemId]')).toBe('1234567890');
    });

    it('מקבל itemId כמחרוזת', () => {
        const link = buildDayOffDeepLink(BASE, '987');
        expect(new URL(link).searchParams.get('app[itemId]')).toBe('987');
    });

    it('תומך גם ב-http', () => {
        const link = buildDayOffDeepLink('http://example.monday.com/custom_objects/1', 5);
        expect(link).toBe('http://example.monday.com/custom_objects/1?app%5BitemId%5D=5');
    });

    it('משמר query params קיימים ב-baseUrl', () => {
        const link = buildDayOffDeepLink(`${BASE}?foo=bar`, 42);
        const url = new URL(link);
        expect(url.searchParams.get('foo')).toBe('bar');
        expect(url.searchParams.get('app[itemId]')).toBe('42');
    });

    it('עוטף מרווחים סביב ה-baseUrl', () => {
        const link = buildDayOffDeepLink(`  ${BASE}  `, 7);
        expect(link).toBe(`${BASE}?app%5BitemId%5D=7`);
    });

    it.each([
        ['ריק', ''],
        ['רק רווחים', '   '],
        ['לא http(s)', 'ftp://example.com/x'],
        ['ללא סכמה', 'example.monday.com/custom_objects/1'],
        ['javascript URI', 'javascript:alert(1)'],
        ['null', null],
        ['undefined', undefined],
        ['לא מחרוזת', 12345],
    ])('מחזיר null עבור baseUrl לא תקין (%s)', (_label, badUrl) => {
        expect(buildDayOffDeepLink(badUrl, 1)).toBeNull();
    });

    it.each([
        ['null', null],
        ['undefined', undefined],
        ['מחרוזת ריקה', ''],
        ['רק רווחים', '  '],
    ])('מחזיר null כשחסר itemId (%s)', (_label, badId) => {
        expect(buildDayOffDeepLink(BASE, badId)).toBeNull();
    });
});
