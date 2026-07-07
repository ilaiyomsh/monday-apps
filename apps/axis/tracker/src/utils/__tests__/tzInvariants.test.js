import { describe, it, expect } from 'vitest';
import {
    toMondayDateFormat,
    toMondayTimeFormat,
    toLocalDateFormat
} from '../dateFormatters';

/**
 * TZ Invariants (Phase 4)
 *
 * הטסטים האלה אמורים לעבור תחת כל timezone — Asia/Jerusalem, UTC,
 * America/New_York. מריצים אותם דרך:
 *   pnpm run test:tz:matrix
 *
 * מטרה: לתפוס באגים שמסתתרים מתחת ל-TZ ספציפי. בעיקר חשוב לקראת
 * מיגרציית i18n כי משתמשים באנגלית עלולים להיות באזורים אחרים, אבל
 * ה-baseline הזה רלוונטי גם לפני המיגרציה.
 *
 * חשוב: הטסטים נכתבים כך שהציפייה מותאמת ל-TZ הנוכחי (process.env.TZ).
 * זה דורש זהירות כשכותבים assertions — להשתמש ב-getUTC או getLocal בהתאם.
 */

describe('TZ invariants — toMondayDateFormat (UTC-based)', () => {
    it('Date(2026-05-04 12:00 UTC) → "2026-05-04" בכל TZ', () => {
        // Date built from UTC ms — לא תלוי TZ של ה-runner
        const utcDate = new Date(Date.UTC(2026, 4, 4, 12, 0));
        expect(toMondayDateFormat(utcDate)).toBe('2026-05-04');
    });

    it('Date(2026-05-04 23:30 UTC) — getUTCDate חוזר 4', () => {
        const utcDate = new Date(Date.UTC(2026, 4, 4, 23, 30));
        expect(toMondayDateFormat(utcDate)).toBe('2026-05-04');
    });

    it('Date(2026-05-05 00:30 UTC) — getUTCDate חוזר 5', () => {
        const utcDate = new Date(Date.UTC(2026, 4, 5, 0, 30));
        expect(toMondayDateFormat(utcDate)).toBe('2026-05-05');
    });

    it('toMondayTimeFormat נותן UTC time', () => {
        const utcDate = new Date(Date.UTC(2026, 4, 4, 14, 30, 0));
        expect(toMondayTimeFormat(utcDate)).toBe('14:30:00');
    });
});

describe('TZ invariants — toLocalDateFormat (local-based)', () => {
    it('Date שנוצר עם בנאי לוקאלי — מחזיר את היום הלוקאלי, לא UTC', () => {
        // new Date(year, month, day, hours, ...) מתפרש כלוקאלי.
        // לא משנה באיזה TZ — getFullYear/getMonth/getDate חוזרים את הלוקאלי.
        const localDate = new Date(2026, 4, 4, 23, 30);
        expect(toLocalDateFormat(localDate)).toBe('2026-05-04');
    });

    it('כש-end exclusive (ימי אירוע יומי) — חישוב משך לא קופץ ב-DST', () => {
        // יום ראשון 2026-05-03 — לא DST boundary בישראל
        const start = new Date(2026, 4, 3);
        const end = new Date(2026, 4, 6); // exclusive — 3 ימים
        const days = Math.round((end - start) / (24 * 60 * 60 * 1000));
        // חישוב ms-based רגיש ל-DST. לאירועים יומיים זה צריך להישאר 3.
        expect(days).toBe(3);
    });
});

describe('TZ invariants — round-trip', () => {
    it('Date(UTC) → toMondayDateFormat → אותו תאריך', () => {
        const original = new Date(Date.UTC(2026, 4, 4, 10, 0));
        const formatted = toMondayDateFormat(original);
        const [y, m, d] = formatted.split('-').map(Number);
        expect(y).toBe(2026);
        expect(m).toBe(5);  // human-readable month
        expect(d).toBe(4);
    });

    it('Date local → toLocalDateFormat → אותו תאריך לוקאלי', () => {
        const original = new Date(2026, 4, 4);
        const formatted = toLocalDateFormat(original);
        const [y, m, d] = formatted.split('-').map(Number);
        expect(y).toBe(2026);
        expect(m).toBe(5);
        expect(d).toBe(4);
    });
});

describe('TZ invariants — חיזוק ל-DST', () => {
    it('מעבר 2026-03-27 (שעון קיץ ישראל) — אורך יום מקומי לא משבש days diff', () => {
        // ביום המעבר עצמו השעון מתקדם, אבל לחישוב ימים אנחנו עוגנים
        // לחצות לוקאלית, וצריכים להישאר עקביים.
        const before = new Date(2026, 2, 26); // 26 מרץ
        const after = new Date(2026, 2, 30);  // 30 מרץ — 4 ימים אחרי
        const ms = after - before;
        const days = Math.round(ms / (24 * 60 * 60 * 1000));
        // round() מטפל ב-±1 שעה של DST shift.
        expect(days).toBe(4);
    });

    it('משך אירוע שעתי מ-09:00 עד 11:30 לוקאלי = 2.5 שעות', () => {
        const start = new Date(2026, 4, 4, 9, 0);
        const end = new Date(2026, 4, 4, 11, 30);
        const minutes = (end - start) / 60000;
        expect(minutes).toBe(150); // 2.5 שעות = 150 דקות
    });
});

describe('TZ invariants — דוקומנטציה למפתחים', () => {
    it('process.env.TZ הוא הפנייה לאיזון הטסטים — לוג בלבד', () => {
        // הטסט הזה פשוט מתעד את ה-TZ הנוכחי שתחתיו אנחנו רצים.
        // משמש כסיגנל ב-CI logs.
        const tz = process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown';
        expect(typeof tz).toBe('string');
        expect(tz.length).toBeGreaterThan(0);
    });
});
