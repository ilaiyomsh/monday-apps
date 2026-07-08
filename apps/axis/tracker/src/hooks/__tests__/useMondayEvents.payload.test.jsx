import { describe, it, expect, beforeEach } from 'vitest';
import { act, waitFor } from '@testing-library/react';
import { useMondayEvents } from '../useMondayEvents';
import { useSettings } from '../../contexts/SettingsContext';
import { createMondayMock } from '../../test-utils/mondayMock';
import { createApiPayloadCapture } from '../../test-utils/apiPayloadCapture';
import { renderHookWithProviders } from '../../test-utils/renderHookWithProviders';
import { findStatusColumnWrites, assertNoForbiddenStrings } from '../../utils/payloadGuard';

// הגדרות מינימליות לטסט — מדמה לוח דיווחים מוגדר במלואו.
// המספרים האלה הם מזהים שרירותיים של עמודות בלוח של Monday.
const TEST_SETTINGS = {
    connectedBoardId: '1001',
    timeReportingBoardId: '2002',
    useCurrentBoardForReporting: false,
    dateColumnId: 'date_col',
    durationColumnId: 'duration_col',
    endTimeColumnId: 'end_time_col',
    projectColumnId: 'project_col',
    taskColumnId: 'task_col',
    reporterColumnId: 'reporter_col',
    eventTypeStatusColumnId: 'event_type_col',
    nonBillableStatusColumnId: 'non_billable_col',
    stageColumnId: 'stage_col',
    notesColumnId: 'notes_col',
    eventTypeMapping: {
        '0': 'allDay',          // חופשה
        '2': 'allDay',          // מחלה
        '3': 'billable',        // שעתי
        '5': 'temporary',       // זמני
        '6': 'allDay',          // מילואים
        '101': 'nonBillable'    // שוטף
    },
    eventTypeLabelMeta: {
        '3': { label: 'שעתי', color: '#0073ea' },
        '101': { label: 'שוטף', color: '#fdab3d' }
    },
    enableProjectTypeDistinction: false,
    enableApproval: false,
    lastModifiedAt: '2026-01-01T00:00:00.000Z'
};

const TEST_CONTEXT = {
    boardId: 2002,
    user: { id: '7', name: 'בודק' }
};

describe('useMondayEvents — payload preservation (Phase 2c)', () => {

    let monday;
    let capture;

    beforeEach(() => {
        monday = createMondayMock({
            context: TEST_CONTEXT,
            apiResponses: {
                'create_item': { data: { create_item: { id: '999', name: 'New Event' } } }
            }
        });
        capture = createApiPayloadCapture(monday);
    });

    /**
     * עזר: מרנדר את ההוק עם ה-providers ומחכה שה-SettingsContext
     * יסיים לטעון את ההגדרות שהזרענו (אחרת createEvent חוזר מוקדם
     * עם "חסרות הגדרות נדרשות").
     */
    async function setupHook(overrides = {}) {
        const mondayInstance = overrides.monday || monday;
        const { result } = renderHookWithProviders(
            () => ({
                events: useMondayEvents(mondayInstance, TEST_CONTEXT),
                settings: useSettings()
            }),
            {
                monday: mondayInstance,
                initialContext: overrides.initialContext || TEST_CONTEXT,
                initialSettings: overrides.initialSettings || TEST_SETTINGS,
                language: overrides.language
            }
        );
        await waitFor(() => {
            expect(result.current.settings.isLoading).toBe(false);
            expect(result.current.settings.customSettings.dateColumnId).toBe('date_col');
        });
        return result;
    }

    /**
     * עזר: שולף את ה-column_values שנשלחו ב-create_item.
     * monday.api מקבלת ({ variables }) — אז ה-vars שלנו עטופים בעוד שכבה.
     */
    function getCreateItemColumnValues() {
        const call = capture.find(/create_item/);
        expect(call, 'create_item call must be captured').toBeDefined();
        const innerVars = call.variables?.variables || call.variables;
        const raw = innerVars?.columnValues;
        expect(raw, 'columnValues variable must be present').toBeTruthy();
        return JSON.parse(raw);
    }

    describe('יצירת אירוע שעתי (billable)', () => {
        it('שולח index לעמודת event type — לא טקסט', async () => {
            const result = await setupHook();
            await act(async () => {
                await result.current.events.createEvent(
                    { title: 'דיווח שעתי', isBillable: true, itemId: '500' },
                    new Date(2026, 4, 4, 10, 0),
                    new Date(2026, 4, 4, 12, 0)
                );
            });

            const cv = getCreateItemColumnValues();
            expect(cv['event_type_col']).toEqual({ index: 3 });
            expect(cv['event_type_col']).not.toHaveProperty('label');
            expect(cv['event_type_col']).not.toHaveProperty('text');
        });

        it('שולח item_ids לעמודת project — לא שם פרויקט', async () => {
            const result = await setupHook();
            await act(async () => {
                await result.current.events.createEvent(
                    { title: 't', isBillable: true, itemId: '500', project: { id: '500', name: 'פרויקט אלפא' } },
                    new Date(2026, 4, 4, 10, 0),
                    new Date(2026, 4, 4, 12, 0)
                );
            });

            const cv = getCreateItemColumnValues();
            expect(cv['project_col']).toEqual({ item_ids: [500] });
            // וידוא שהשם של הפרויקט לא דלף ל-payload
            expect(JSON.stringify(cv)).not.toContain('פרויקט אלפא');
        });

        it('שולח personsAndTeams לעמודת reporter — לא שם משתמש', async () => {
            const result = await setupHook();
            await act(async () => {
                await result.current.events.createEvent(
                    { title: 't', isBillable: true },
                    new Date(2026, 4, 4, 10, 0),
                    new Date(2026, 4, 4, 12, 0)
                );
            });

            const cv = getCreateItemColumnValues();
            expect(cv['reporter_col']).toEqual({
                personsAndTeams: [{ id: 7, kind: 'person' }]
            });
            expect(JSON.stringify(cv)).not.toContain('בודק');
        });
    });

    describe('יצירת אירוע "לא לחיוב" (שוטף)', () => {
        it('שולח label לעמודת nonBillable עם הערך המקורי בלי תרגום', async () => {
            const result = await setupHook();
            await act(async () => {
                await result.current.events.createEvent(
                    { title: 't', isBillable: false, nonBillableType: 'פגישה' },
                    new Date(2026, 4, 4, 10, 0),
                    new Date(2026, 4, 4, 11, 0)
                );
            });

            const cv = getCreateItemColumnValues();
            // event_type מקבל את ה-index של "שוטף"
            expect(cv['event_type_col']).toEqual({ index: 101 });
            // nonBillable שומר על הערך המקורי שהמשתמש בחר
            expect(cv['non_billable_col']).toEqual({ label: 'פגישה' });
        });

        it('round-trip — הערך שיוצא ל-API זהה לערך שהוזן', async () => {
            const result = await setupHook();
            const userInput = 'הדרכה פנימית';
            await act(async () => {
                await result.current.events.createEvent(
                    { title: 't', isBillable: false, nonBillableType: userInput },
                    new Date(2026, 4, 4, 10, 0),
                    new Date(2026, 4, 4, 11, 0)
                );
            });

            const cv = getCreateItemColumnValues();
            expect(cv['non_billable_col'].label).toBe(userInput);
        });
    });

    describe('הגנה כללית — אין תרגומי UI ב-payload', () => {
        it('אין מחרוזות שנראות כמפתח i18n בערכי עמודות', async () => {
            const result = await setupHook();
            await act(async () => {
                await result.current.events.createEvent(
                    { title: 'דיווח', isBillable: true, itemId: '500', notes: 'הערה חופשית' },
                    new Date(2026, 4, 4, 10, 0),
                    new Date(2026, 4, 4, 12, 0)
                );
            });

            const cv = getCreateItemColumnValues();
            const TRANSLATIONS_THAT_SHOULD_NEVER_LEAK = [
                'common.save', 'event.type.hourly', 'event.type.routine',
                'Hourly', 'Routine', 'Vacation'
            ];
            // notes הוא שדה חופשי שמשתמש מקליד — מותר בו כל טקסט
            expect(() =>
                assertNoForbiddenStrings(cv, TRANSLATIONS_THAT_SHOULD_NEVER_LEAK, { allowedKeys: ['notes_col'] })
            ).not.toThrow();
        });

        it('כל ה-status writes משתמשים ב-shape תקני (index או label)', async () => {
            const result = await setupHook();
            await act(async () => {
                await result.current.events.createEvent(
                    { title: 't', isBillable: true, itemId: '500' },
                    new Date(2026, 4, 4, 10, 0),
                    new Date(2026, 4, 4, 12, 0)
                );
            });

            const cv = getCreateItemColumnValues();
            const writes = findStatusColumnWrites(cv);
            expect(writes.length).toBeGreaterThan(0);
            for (const w of writes) {
                expect(['index', 'label']).toContain(w.shape);
            }
        });
    });

    describe('יציבות payload בין שפות UI', () => {
        it('אותם נתונים → אותו payload, בלי תלות ב-language', async () => {
            // הרצה ראשונה
            const r1 = await setupHook();
            await act(async () => {
                await r1.current.events.createEvent(
                    { title: 'דיווח', isBillable: true, itemId: '500' },
                    new Date(2026, 4, 4, 10, 0),
                    new Date(2026, 4, 4, 12, 0)
                );
            });
            const cv1 = getCreateItemColumnValues();

            // איפוס ויצירה מחדש עם monday חדש (כדי לדמות session שונה)
            capture.reset();
            const enMonday = createMondayMock({
                context: { ...TEST_CONTEXT, user: { ...TEST_CONTEXT.user, currentLanguage: 'en' } },
                apiResponses: {
                    'create_item': { data: { create_item: { id: '999', name: 'New Event' } } }
                }
            });
            capture = createApiPayloadCapture(enMonday);

            const r2 = await setupHook({
                monday: enMonday,
                initialContext: { ...TEST_CONTEXT, user: { ...TEST_CONTEXT.user, currentLanguage: 'en' } },
                language: 'en'
            });

            await act(async () => {
                await r2.current.events.createEvent(
                    { title: 'דיווח', isBillable: true, itemId: '500' },
                    new Date(2026, 4, 4, 10, 0),
                    new Date(2026, 4, 4, 12, 0)
                );
            });
            const cv2 = getCreateItemColumnValues();

            // ה-payload חייב להיות זהה — שפה לא משפיעה על נתונים
            expect(cv2).toEqual(cv1);
        });
    });
});
