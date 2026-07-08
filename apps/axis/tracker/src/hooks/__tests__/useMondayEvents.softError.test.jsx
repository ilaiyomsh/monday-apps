/**
 * בדיקות Phase 2 — "GraphQL רך = הצלחה" סגור במסלול יצירת אירוע.
 *
 * החוזה הנבדק:
 *  1. כש-create_item מחזיר GraphQL soft-error (status 200 עם res.errors),
 *     createEvent זורק (MondayApiError) במקום להחזיר null בשקט.
 *  2. אותו soft-error מאולץ מייצר בדיוק רשומה *אחת* שנושאת את ה-Error
 *     שנזרק (log-once / dedup דרך emit) — לא 2–4.
 *  3. השלד (skeleton) מוסר מה-state אחרי הכשל.
 *
 * חשוב: setupTests.js ממקה את logger גלובלית. כאן צריך את ה-logger האמיתי
 * (כדי לאמת dedup דרך sink אמיתי) — לכן vi.unmock + console-spy כמו ב-logger.test.js.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, waitFor } from '@testing-library/react';
import { useMondayEvents } from '../useMondayEvents';
import { useSettings } from '../../contexts/SettingsContext';
import { createMondayMock } from '../../test-utils/mondayMock';
import { renderHookWithProviders } from '../../test-utils/renderHookWithProviders';
import { MondayApiError } from '../../utils/mondayApi';
import logger from '../../utils/logger';

// vi.unmock מורם ע"י vitest מעל ה-imports (כמו vi.mock) — עוקף את ה-mock הגלובלי
// מ-setupTests.js כדי לקבל את ה-logger האמיתי (נדרש לאימות dedup דרך sink אמיתי).
vi.unmock('../../utils/logger');

const TEST_SETTINGS = {
    timeReportingBoardId: '2002',
    useCurrentBoardForReporting: false,
    dateColumnId: 'date_col',
    durationColumnId: 'duration_col',
    endTimeColumnId: 'end_time_col',
    projectColumnId: 'project_col',
    reporterColumnId: 'reporter_col',
    eventTypeStatusColumnId: 'event_type_col',
    nonBillableStatusColumnId: 'non_billable_col',
    stageColumnId: 'stage_col',
    notesColumnId: 'notes_col',
    eventTypeMapping: {
        '0': 'allDay', '2': 'allDay', '3': 'billable', '5': 'temporary',
        '6': 'allDay', '101': 'nonBillable'
    },
    eventTypeLabelMeta: { '3': { label: 'שעתי' }, '101': { label: 'שוטף' } },
    enableProjectTypeDistinction: false,
    enableApproval: false,
    lastModifiedAt: '2026-01-01T00:00:00.000Z'
};

const TEST_CONTEXT = { boardId: 2002, user: { id: '7', name: 'בודק' } };

// תשובת soft-error: status 200, אין data.create_item, יש res.errors
const SOFT_ERROR_RESPONSE = {
    errors: [
        {
            message: 'User unauthorized to perform action',
            extensions: { code: 'UserUnauthorizedException', status_code: 403 }
        }
    ]
};

// console-spy — מונע זיהום פלט הבדיקות (ה-logger האמיתי מדפיס לקונסול)
let consoleSpies;
beforeEach(() => {
    consoleSpies = {
        log: vi.spyOn(console, 'log').mockImplementation(() => {}),
        error: vi.spyOn(console, 'error').mockImplementation(() => {}),
        group: vi.spyOn(console, 'group').mockImplementation(() => {}),
        groupEnd: vi.spyOn(console, 'groupEnd').mockImplementation(() => {}),
    };
});
afterEach(() => {
    Object.values(consoleSpies).forEach((s) => s.mockRestore());
});

async function setupHook(monday) {
    const { result } = renderHookWithProviders(
        () => ({
            events: useMondayEvents(monday, TEST_CONTEXT),
            settings: useSettings()
        }),
        { monday, initialContext: TEST_CONTEXT, initialSettings: TEST_SETTINGS }
    );
    await waitFor(() => {
        expect(result.current.settings.isLoading).toBe(false);
        expect(result.current.settings.customSettings.dateColumnId).toBe('date_col');
    });
    return result;
}

describe('useMondayEvents.createEvent — GraphQL soft-error (Phase 2)', () => {
    let monday;

    beforeEach(() => {
        monday = createMondayMock({
            context: TEST_CONTEXT,
            apiResponsesByOp: { create_item: SOFT_ERROR_RESPONSE }
        });
    });

    it('soft-error → createEvent זורק MondayApiError (לא מחזיר null בשקט)', async () => {
        const result = await setupHook(monday);

        let thrown;
        await act(async () => {
            try {
                await result.current.events.createEvent(
                    { title: 'דיווח', isBillable: true, itemId: '500' },
                    new Date(2026, 4, 4, 10, 0),
                    new Date(2026, 4, 4, 12, 0)
                );
            } catch (e) {
                thrown = e;
            }
        });

        expect(thrown).toBeInstanceOf(MondayApiError);
    });

    it('soft-error מאולץ → בדיוק רשומה אחת (לא-כפולה) מגיעה לסינק עבור כל הפעולה', async () => {
        // סופרים את *כל* רשומות ה-ERROR — לא רק MondayApiError — כדי שהטסט לא
        // יחמיץ רשומה שנייה מסוג אחר (החוזה: כשל אחד == רשומה אחת == טוסט אחד).
        const sinkRecords = [];
        const unsub = logger.addSink((record) => {
            if (record.level === 'ERROR') {
                sinkRecords.push(record);
            }
        });

        try {
            const result = await setupHook(monday);
            await act(async () => {
                try {
                    await result.current.events.createEvent(
                        { title: 'דיווח', isBillable: true, itemId: '500' },
                        new Date(2026, 4, 4, 10, 0),
                        new Date(2026, 4, 4, 12, 0)
                    );
                } catch {
                    // הכשל צפוי — נבדק בטסט אחר. כאן בודקים רק רישום-יחיד.
                }
            });

            // הרשומה הקנונית היא של safeApi (apiError עם rawResponse). ה-MondayApiError
            // שנזרק מ-assertNoGraphQLErrors יורש את ה-__loggedId שלה, ולכן רישומו
            // ב-catch של createEvent מסומן duplicate ומדולג מהסינק — רשומה אחת בלבד.
            expect(sinkRecords).toHaveLength(1);
            expect(sinkRecords[0].duplicate).toBe(false);
            // נושאת את ה-rawResponse — ממנו ה-UI sink מפיק את ההודעה הספציפית
            expect(sinkRecords[0].context?.rawResponse?.errors?.length).toBeGreaterThan(0);
        } finally {
            unsub();
        }
    });

    it('soft-error → השלד (skeleton) מוסר מה-state אחרי הכשל', async () => {
        const result = await setupHook(monday);

        await act(async () => {
            try {
                await result.current.events.createEvent(
                    { title: 'דיווח שייכשל', isBillable: true, itemId: '500' },
                    new Date(2026, 4, 4, 10, 0),
                    new Date(2026, 4, 4, 12, 0)
                );
            } catch {
                // צפוי
            }
        });

        await waitFor(() => {
            const pending = result.current.events.events.filter(
                (ev) => typeof ev.id === 'string' && ev.id.startsWith('pending_')
            );
            expect(pending).toHaveLength(0);
        });
    });
});
