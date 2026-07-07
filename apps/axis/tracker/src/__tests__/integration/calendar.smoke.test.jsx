/* global globalThis */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderCalendar } from '../../test-utils/renderCalendar';

/**
 * Smoke test ל-2.1.0 — מוכיח שה-harness מצליח ל-mount את `<App />` תחת
 * jsdom + Monday SDK mock, ושהסריג של react-big-calendar ב-DOM.
 *
 * המטרה אינה לכסות זרימה מסוימת — זה תפקידם של 2.1.1–2.1.6. שם הטסט הוא
 * החוזה: אם זה נופל, אף אחד מהטסטים האחרים לא יעלה.
 */

vi.mock('monday-sdk-js', () => ({
    default: () => globalThis.__testMondayMock
}));

beforeEach(() => {
    // הערה: לא מפעילים fake timers — SettingsContext משתמש ב-setTimeout
    // לשרשרת retry של 500ms, ועם fake timers הטסט תקוע. setSystemTime
    // ב-renderCalendar מספק דטרמיניזם ל-Date ללא fake timers.
});

afterEach(() => {
    // איפוס time-pinning של renderCalendar — מונע דליפה לטסטים אחרים
    vi.useRealTimers();
    delete globalThis.__testMondayMock;
});

describe('Integration smoke — calendar renders end-to-end', () => {
    it('mounts <App /> ומציג את סריג react-big-calendar', async () => {
        const { container } = await renderCalendar();

        const grid = container.querySelector('.rbc-calendar');
        expect(grid).toBeTruthy();
    }, 30000);

    it('seedים customSettings מגיעים ל-storage תחת המפתח הצפוי', async () => {
        const { monday, context } = await renderCalendar();

        const expectedKey = `customSettings_${context.instanceId}`;
        const stored = monday.__getStorage()[expectedKey];
        expect(stored).toBeDefined();

        const parsed = JSON.parse(stored);
        expect(parsed.connectedBoardId).toBe(200);
        expect(parsed.dateColumnId).toBe('date');
    });

    it('mock מחזיר את ה-current user מ-defaults של ה-harness', async () => {
        const { monday } = await renderCalendar();
        const res = await monday.api('query { me { id name } }');
        expect(res.data.me.id).toBe('7');
        expect(res.data.me.name).toBe('Tester');
    });
});
