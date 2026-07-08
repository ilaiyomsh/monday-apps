import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { lazyRetry, prefetchLazy, isChunkLoadError, handleGlobalChunkError, MAX_AUTO_RELOADS } from '../lazyRetry';

/**
 * רקע: הבאג שדווח (2026-06-21) — "האפליקציה עולה ואז הדף עושה ריפרש אוטומטי, לפעמים
 * פעמיים-שלוש ברצף". השורש: preloadLazyModals (ב-MondayCalendar) טוען מראש ברקע 5
 * chunks דרך importers עטופים ב-lazyRetry; כשל טעינת chunk זמני גרם ל-window.location.reload
 * — גם על טעינת רקע שהמשתמש לא ביקש — וה-guards הנפרדים (per-module + global) לא חסמו
 * שרשור reloadים.
 *
 * התיקון: (1) prefetchLazy — טעינה-מקדימה שקטה שלעולם לא מרעננת. (2) תקרת reload גלובלית
 * (MAX_AUTO_RELOADS) שחוסמת שרשור reloadים על-פני מודולים שונים.
 */

// הודעות שגיאה אמיתיות של dynamic-import שנכשל (Chrome/Edge ב-Windows — סביבת המשתמש).
const DYNAMIC_IMPORT_ERRORS = [
    'Failed to fetch dynamically imported module: https://cdn.monday.app/assets/EventModal-abc123.js',
    'error loading dynamically imported module',
    "'text/html' is not a valid JavaScript MIME type", // CDN החזיר index.html במקום הצ'אנק
    'Failed to fetch',                                  // כשל רשת ב-Chrome
    'Load failed',                                      // iOS Safari
];

const chunkError = (msg = DYNAMIC_IMPORT_ERRORS[0]) => new Error(msg);

// מנקז microtasks + macrotask כדי ש-importer().then().catch() יסתיים.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('lazyRetry', () => {
    let reloadSpy;
    let originalLocation;

    beforeEach(() => {
        sessionStorage.clear();
        originalLocation = window.location;
        // window.location.reload לא ניתן ל-spy ישיר; מחליפים את location כולו (כמו ב-SettingsContext.test).
        reloadSpy = vi.fn();
        Object.defineProperty(window, 'location', {
            configurable: true,
            value: { ...originalLocation, reload: reloadSpy },
        });
    });

    afterEach(() => {
        Object.defineProperty(window, 'location', {
            configurable: true,
            value: originalLocation,
        });
        sessionStorage.clear();
        vi.restoreAllMocks();
    });

    describe('זיהוי שגיאות chunk', () => {
        it('כל הודעות הכשל של dynamic-import מזוהות כ-chunk error', () => {
            for (const msg of DYNAMIC_IMPORT_ERRORS) {
                expect(isChunkLoadError(new Error(msg))).toBe(true);
            }
        });

        it('שגיאה רגילה (לא chunk) אינה מזוהה', () => {
            expect(isChunkLoadError(new Error('TypeError: foo is not a function'))).toBe(false);
            expect(isChunkLoadError(null)).toBe(false);
        });
    });

    describe('טעינה-לפי-דרישה (React.lazy) — מרעננת פעם אחת על כשל אמיתי', () => {
        it('כשל chunk ראשון → reload יחיד + רישום guard למודול', async () => {
            const wrapped = lazyRetry(vi.fn().mockRejectedValue(chunkError()), 'EventModal');
            wrapped().catch(() => {});
            await flush();
            expect(reloadSpy).toHaveBeenCalledTimes(1);
            expect(sessionStorage.getItem('lazy-retry:EventModal')).toBe('1');
        });

        it('כשל chunk שני לאותו מודול (אחרי שה-guard נרשם) → אין reload נוסף, נזרק ל-ErrorBoundary', async () => {
            sessionStorage.setItem('lazy-retry:EventModal', '1');
            const wrapped = lazyRetry(vi.fn().mockRejectedValue(chunkError()), 'EventModal');
            await expect(wrapped()).rejects.toThrow();
            await flush();
            expect(reloadSpy).not.toHaveBeenCalled();
        });

        it('שגיאה שאינה chunk → אין reload (נזרקת חזרה כרגיל)', async () => {
            const wrapped = lazyRetry(vi.fn().mockRejectedValue(new Error('boom — logic bug')), 'EventModal');
            await expect(wrapped()).rejects.toThrow('boom');
            await flush();
            expect(reloadSpy).not.toHaveBeenCalled();
        });

        it('הצלחה → מנקה את ה-guard של המודול', async () => {
            sessionStorage.setItem('lazy-retry:EventModal', '1');
            const wrapped = lazyRetry(vi.fn().mockResolvedValue({ default: () => null }), 'EventModal');
            await wrapped();
            expect(sessionStorage.getItem('lazy-retry:EventModal')).toBeNull();
            expect(reloadSpy).not.toHaveBeenCalled();
        });
    });

    describe('תיקון הבאג: תקרת reload גלובלית', () => {
        it('5 מודולים שנכשלים → לכל היותר MAX_AUTO_RELOADS reloadים (לא 5)', async () => {
            // לפני התיקון: כל מודול הפעיל reload עצמאי (5 ברצף — שורש ה"2-3").
            const modules = ['EventModal', 'AllDayEventModal', 'ContextMenu', 'SelectionActionBar', 'ApprovalActionBar'];
            for (const name of modules) {
                const err = chunkError(`Failed to fetch dynamically imported module: /assets/${name}-x.js`);
                lazyRetry(vi.fn().mockRejectedValue(err), name)().catch(() => {});
            }
            await flush();
            expect(reloadSpy).toHaveBeenCalledTimes(MAX_AUTO_RELOADS);
            expect(MAX_AUTO_RELOADS).toBe(1);
        });

        it('handleGlobalChunkError לא מרענן אחרי שתקציב ה-reload מוצה ע"י lazyRetry', async () => {
            // reload ראשון נצרך ע"י נתיב lazyRetry (מודול בודד)...
            lazyRetry(vi.fn().mockRejectedValue(chunkError()), 'EventModal')().catch(() => {});
            await flush();
            expect(reloadSpy).toHaveBeenCalledTimes(1);

            // ...ולכן rejection גלובלי נוסף כבר *לא* מוסיף reload (התקרה חוסמת את השרשור).
            const handled = handleGlobalChunkError(chunkError());
            expect(handled).toBe(true);             // עדיין מטופל (event.preventDefault)
            expect(reloadSpy).toHaveBeenCalledTimes(1); // אבל בלי reload שני
        });

        it('handleGlobalChunkError מרענן פעם אחת כשהתקציב פנוי', () => {
            expect(handleGlobalChunkError(chunkError())).toBe(true);
            expect(reloadSpy).toHaveBeenCalledTimes(1);
            // קריאה שנייה — התקציב מוצה
            expect(handleGlobalChunkError(chunkError())).toBe(true);
            expect(reloadSpy).toHaveBeenCalledTimes(1);
        });
    });

    describe('תיקון הבאג: prefetchLazy — טעינה-מקדימה שקטה שלעולם לא מרעננת', () => {
        it('כשל chunk בטעינה-מקדימה → אין reload (זה הליבה של התיקון)', async () => {
            await prefetchLazy(vi.fn().mockRejectedValue(chunkError()), 'EventModal');
            expect(reloadSpy).not.toHaveBeenCalled();
            // גם לא נרשם guard ולא נצרך תקציב reload — נתיב ה-prefetch אדיש ל-reload לחלוטין.
            expect(sessionStorage.getItem('lazy-retry:reload-count')).toBeNull();
        });

        it('גם 5 כשלי-prefetch במקביל → אפס reloadים (התרחיש המדויק של preloadLazyModals)', async () => {
            const modules = ['EventModal', 'AllDayEventModal', 'ContextMenu', 'SelectionActionBar', 'ApprovalActionBar'];
            await Promise.all(
                modules.map((name) => prefetchLazy(vi.fn().mockRejectedValue(chunkError()), name))
            );
            expect(reloadSpy).not.toHaveBeenCalled();
        });

        it('תמיד מחזיר promise שנפתר (גם על כשל) — בלי unhandled rejection', async () => {
            await expect(prefetchLazy(vi.fn().mockRejectedValue(chunkError()), 'X')).resolves.toBeUndefined();
        });

        it('הצלחה → מנקה guard ישן כדי שטעינה-לפי-דרישה עתידית תתחיל נקייה', async () => {
            sessionStorage.setItem('lazy-retry:EventModal', '1');
            await prefetchLazy(vi.fn().mockResolvedValue({ default: () => null }), 'EventModal');
            expect(sessionStorage.getItem('lazy-retry:EventModal')).toBeNull();
            expect(reloadSpy).not.toHaveBeenCalled();
        });

        it('importer שזורק סינכרונית → נבלע בשקט, בלי reload', async () => {
            await expect(prefetchLazy(() => { throw chunkError(); }, 'X')).resolves.toBeUndefined();
            expect(reloadSpy).not.toHaveBeenCalled();
        });
    });
});
