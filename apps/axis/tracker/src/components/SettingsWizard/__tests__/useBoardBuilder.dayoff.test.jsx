import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useBoardBuilder } from '../useBoardBuilder';
import { createMondayMock } from '../../../test-utils/mondayMock';

/**
 * W4.6 — יצירה מותנית של עמודת תת-סוג היומי (All-day Type) באשף:
 * נוצרת רק כשההיעדרויות פנימיות (absenceSource='tracker' או לא מוגדר);
 * מדולגת כשהמקור חיצוני ('dayoff') — ואז settings.allDayTypeStatusColumnId
 * נשמר null (חוקי תחת מקור dayoff לפי הוולידטור של W4.5).
 * חל על שתי הזרימות: build (לוחות מלאים) ו-buildPortfolio.
 */

const TEST_CONTEXT = { boardId: 123 };

const SKIP_LOG_LINE = '  • All-day Type — skipped (absences are managed in the Day-off app)';

// state משותף לכל תגובות ה-mock — אוסף את העמודות שנוצרו בפועל
const makeState = () => ({ seq: 0, createdColumns: [] });

const makeMonday = (state) => createMondayMock({
    context: TEST_CONTEXT,
    apiResponsesByOp: {
        create_board: () => ({
            data: { create_board: { id: `board_${++state.seq}` } }
        }),
        // create_status_column נבנה inline (ללא variables) — הכותרת מחולצת מהשאילתה
        create_status_column: (query) => {
            const title = (query.match(/title:\s*"([^"]+)"/) || [])[1] || 'unknown';
            const id = `status_${++state.seq}`;
            state.createdColumns.push({ id, title });
            return {
                data: {
                    create_status_column: {
                        id,
                        settings_str: JSON.stringify({ labels: [] })
                    }
                }
            };
        },
        create_column: (query, opts) => {
            const id = `col_${++state.seq}`;
            state.createdColumns.push({ id, title: opts?.variables?.title });
            return { data: { create_column: { id } } };
        },
        create_item: () => ({
            data: { create_item: { id: `item_${++state.seq}` } }
        }),
        change_multiple_column_values: () => ({
            data: { change_multiple_column_values: { id: '1' } }
        }),
        me: () => ({ data: { me: { id: 7, name: 'Tester' } } })
    },
    apiResponses: {
        // resolveLocation — שאילתת boards עם workspace_id
        'workspace_id': { data: { boards: [{ workspace_id: '500', board_folder_id: null }] } },
        // buildPortfolio — שליפת פריטי הפורטפוליו ל-seed (ריק = דילוג על seed)
        'items_page': { data: { boards: [{ items_page: { items: [] } }] } }
    }
});

const BOARD_ANSWERS = { source: 'board', tasks: false, stages: false, distinction: false };
const PORTFOLIO_ANSWERS = {
    source: 'portfolio',
    portfolioBoardId: '999',
    tasks: false,
    stages: false,
    distinction: false,
    projectTypeColumnId: null,
    projectTypeMapping: null
};

const runBuild = async (answers) => {
    const state = makeState();
    const monday = makeMonday(state);
    const { result } = renderHook(() => useBoardBuilder(monday, TEST_CONTEXT));
    let settings;
    await act(async () => {
        settings = await result.current.build(answers);
    });
    return { state, settings, result };
};

describe('useBoardBuilder — יצירה מותנית של עמודת All-day Type (W4.6/D3)', () => {

    it('זרימת board ללא absenceSource (ברירת מחדל) — עמודת All-day Type נוצרת וההגדרות מצביעות עליה', async () => {
        const { state, settings } = await runBuild({ ...BOARD_ANSWERS });

        const allDayCol = state.createdColumns.find((c) => c.title === 'All-day Type');
        expect(allDayCol).toBeTruthy();
        expect(settings.allDayTypeStatusColumnId).toBe(allDayCol.id);
    });

    it("זרימת board עם absenceSource='tracker' — התנהגות זהה לברירת המחדל", async () => {
        const { state, settings } = await runBuild({ ...BOARD_ANSWERS, absenceSource: 'tracker' });

        const allDayCol = state.createdColumns.find((c) => c.title === 'All-day Type');
        expect(allDayCol).toBeTruthy();
        expect(settings.allDayTypeStatusColumnId).toBe(allDayCol.id);
    });

    it("זרימת board עם absenceSource='dayoff' — העמודה מדולגת, ההגדרות null, ושאר העמודות נוצרות", async () => {
        const { state, settings, result } = await runBuild({ ...BOARD_ANSWERS, absenceSource: 'dayoff' });

        const titles = state.createdColumns.map((c) => c.title);
        expect(titles).not.toContain('All-day Type');
        expect(settings.allDayTypeStatusColumnId).toBeNull();

        // שומר מפני over-skip: העמודות השכנות עדיין נוצרות
        expect(titles).toContain('Event Type');
        expect(titles).toContain('Routine Type');
        expect(titles).toContain('Temporary');
        expect(settings.timeReportingBoardId).toBeTruthy();

        // הדילוג מדווח ביומן ההתקדמות (גלוי למשתמש ב-InstallStep)
        expect(result.current.progress).toContain(SKIP_LOG_LINE);
    });

    it('זרימת portfolio ללא absenceSource — עמודת All-day Type נוצרת וההגדרות מצביעות עליה', async () => {
        const { state, settings } = await runBuild({ ...PORTFOLIO_ANSWERS });

        const allDayCol = state.createdColumns.find((c) => c.title === 'All-day Type');
        expect(allDayCol).toBeTruthy();
        expect(settings.allDayTypeStatusColumnId).toBe(allDayCol.id);
    });

    it("זרימת portfolio עם absenceSource='dayoff' — העמודה מדולגת, ההגדרות null, ושאר העמודות נוצרות", async () => {
        const { state, settings, result } = await runBuild({ ...PORTFOLIO_ANSWERS, absenceSource: 'dayoff' });

        const titles = state.createdColumns.map((c) => c.title);
        expect(titles).not.toContain('All-day Type');
        expect(settings.allDayTypeStatusColumnId).toBeNull();

        expect(titles).toContain('Event Type');
        expect(titles).toContain('Routine Type');
        expect(titles).toContain('Temporary');
        expect(settings.timeReportingBoardId).toBeTruthy();

        expect(result.current.progress).toContain(SKIP_LOG_LINE);
    });
});
