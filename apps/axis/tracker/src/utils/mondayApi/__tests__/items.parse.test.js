/**
 * בדיקות Phase 4 (H4) — findProjectLinkColumn לא בולע בשתיקה כשל פענוח settings.
 *
 * החוזה:
 *  1. עמודת board_relation עם settings פגום (JSON לא תקין) — מדלגים אליה,
 *     רושמים logger.warn, וממשיכים לעמודה הבאה (לא קורסים, לא בולעים בשתיקה).
 *  2. עמודה תקינה אחרי הפגומה — עדיין מותאמת ומוחזרת.
 *  3. כשאין התאמה כלל — מוחזר null (לא throw).
 *
 * logger אמיתי (vi.unmock) + sink אמיתי כדי לאמת שה-catch אכן רושם warn.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { findProjectLinkColumn } from '../items';
import logger from '../../logger';

vi.unmock('../../logger');

let consoleSpies;
beforeEach(() => {
    consoleSpies = {
        log: vi.spyOn(console, 'log').mockImplementation(() => {}),
        error: vi.spyOn(console, 'error').mockImplementation(() => {}),
        warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
        group: vi.spyOn(console, 'group').mockImplementation(() => {}),
        groupEnd: vi.spyOn(console, 'groupEnd').mockImplementation(() => {}),
    };
});
afterEach(() => {
    Object.values(consoleSpies).forEach((s) => s.mockRestore());
});

const makeMonday = (columns) => ({
    api: vi.fn(async () => ({ data: { boards: [{ columns }] } }))
});

describe('findProjectLinkColumn — settings פגום (Phase 4 H4)', () => {
    it('מדלג על עמודה עם settings פגום, רושם warn, וממשיך לעמודה התקינה', async () => {
        const warnRecords = [];
        const unsub = logger.addSink((r) => { if (r.level === 'WARN') warnRecords.push(r); });
        try {
            const monday = makeMonday([
                { id: 'bad', type: 'board_relation', settings: '{not valid json' },
                { id: 'good', type: 'board_relation', settings: JSON.stringify({ boardIds: [777] }) },
            ]);

            const result = await findProjectLinkColumn(monday, 100, 777);

            expect(result).toBe('good');
            // ה-catch של העמודה הפגומה רשם warn (אין בליעה שקטה)
            expect(warnRecords.some((r) => r.message?.includes('Failed to parse'))).toBe(true);
        } finally {
            unsub();
        }
    });

    it('אין התאמה → מחזיר null (לא קורס)', async () => {
        const monday = makeMonday([
            { id: 'other', type: 'board_relation', settings: JSON.stringify({ boardIds: [999] }) },
        ]);
        await expect(findProjectLinkColumn(monday, 100, 777)).resolves.toBeNull();
    });
});
