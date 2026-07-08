import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, waitFor } from '@testing-library/react';
import { useAllDayEvents } from '../useAllDayEvents';
import { useSettings } from '../../contexts/SettingsContext';
import { createMondayMock } from '../../test-utils/mondayMock';
import { createApiPayloadCapture } from '../../test-utils/apiPayloadCapture';
import { renderHookWithProviders } from '../../test-utils/renderHookWithProviders';
import { findStatusColumnWrites, assertNoForbiddenStrings } from '../../utils/payloadGuard';

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
    allDayTypeStatusColumnId: 'allday_type_col',
    temporaryCheckboxColumnId: 'temp_col',
    nonBillableStatusColumnId: 'non_billable_col',
    stageColumnId: 'stage_col',
    notesColumnId: 'notes_col',
    eventTypeMapping: {
        '0': 'allDay',          // יומי (לייבל יחיד; התת-סוגים בעמודה נפרדת)
        '3': 'billable',        // שעתי
        '101': 'nonBillable'    // שוטף
    },
    eventTypeLabelMeta: {
        '0': { label: 'יומי' },
        '3': { label: 'שעתי' },
        '101': { label: 'שוטף' }
    },
    enableProjectTypeDistinction: false,
    enableApproval: false,
    // W4.8 (אינטגרציית Day-off): הסוויטה נועלת את מסלול הכתיבה הוותיק —
    // הצמדה מפורשת של מקור ההיעדרויות (זהה לברירת המחדל; תחת 'dayoff'
    // שער W4.4 היה חוסם את create_item שנבדק כאן)
    absenceSource: 'tracker',
    lastModifiedAt: '2026-01-01T00:00:00.000Z'
};

const TEST_CONTEXT = {
    boardId: 2002,
    user: { id: '7', name: 'בודק' }
};

describe('useAllDayEvents — payload preservation (Phase 2d)', () => {

    let monday;
    let capture;
    let modalsStub;
    let addEvent;
    let resolvePendingEvent;
    let removePendingEvent;

    beforeEach(() => {
        monday = createMondayMock({
            context: TEST_CONTEXT,
            apiResponses: {
                'create_item': { data: { create_item: { id: '999', name: 'Created' } } }
            }
        });
        capture = createApiPayloadCapture(monday);
        modalsStub = {
            allDayModal: { eventToEdit: null },
            closeAllDayModal: vi.fn()
        };
        addEvent = vi.fn();
        resolvePendingEvent = vi.fn();
        removePendingEvent = vi.fn();
    });

    /**
     * עזר: מרנדר את ההוק עם providers ומחכה שהגדרות ייטענו.
     */
    async function setupHook() {
        const { result } = renderHookWithProviders(
            () => ({
                allDay: useAllDayEvents({
                    monday,
                    context: TEST_CONTEXT,
                    modals: modalsStub,
                    showSuccess: vi.fn(),
                    showError: vi.fn(),
                    showWarning: vi.fn(),
                    loadEvents: vi.fn(),
                    addEvent,
                    resolvePendingEvent,
                    removePendingEvent,
                    currentViewRange: { start: new Date(2026, 4, 1), end: new Date(2026, 4, 31) }
                }),
                settings: useSettings()
            }),
            {
                monday,
                initialContext: TEST_CONTEXT,
                initialSettings: TEST_SETTINGS
            }
        );
        await waitFor(() => {
            expect(result.current.settings.isLoading).toBe(false);
            expect(result.current.settings.customSettings.dateColumnId).toBe('date_col');
        });
        return result;
    }

    /**
     * עזר: שולף את כל הקריאות ל-create_item ומחזיר את ה-column_values שלהן.
     * monday.api מקבלת ({ variables }) — צריך לשלוף שכבה פנימית.
     */
    function getAllCreateItemColumnValues() {
        const calls = capture.findAll(/create_item/);
        return calls.map(call => {
            const innerVars = call.variables?.variables || call.variables;
            return JSON.parse(innerVars.columnValues);
        });
    }

    describe('יצירת אירוע יומי בודד (תת-סוג: Vacation/Sick/...)', () => {
        it('Vacation ליום אחד — event_type=0 (יומי), allday_type=2 (תת-סוג)', async () => {
            const result = await setupHook();
            await act(async () => {
                await result.current.allDay.handleCreateAllDayEvent({
                    type: 2,                  // index בעמודת התת-סוג (allDayTypeStatusColumnId)
                    typeLabel: 'Vacation',
                    date: new Date(2026, 4, 4),
                    durationDays: 1
                });
            });

            const cvs = getAllCreateItemColumnValues();
            expect(cvs).toHaveLength(1);
            // event_type_col תמיד מקבל את הלייבל היחיד "יומי" (index=0)
            expect(cvs[0]['event_type_col']).toEqual({ index: 0 });
            // allday_type_col מקבל את התת-סוג שנבחר ע"י המשתמש
            expect(cvs[0]['allday_type_col']).toEqual({ index: 2 });
            expect(cvs[0]['event_type_col']).not.toHaveProperty('label');
        });

        it('Sick ל-3 ימים — יוצר 3 אייטמים זהים', async () => {
            const result = await setupHook();
            await act(async () => {
                await result.current.allDay.handleCreateAllDayEvent({
                    type: 1,                  // התת-סוג של Sick
                    typeLabel: 'Sick',
                    date: new Date(2026, 4, 4),
                    durationDays: 3
                });
            });

            const cvs = getAllCreateItemColumnValues();
            expect(cvs).toHaveLength(3);
            for (const cv of cvs) {
                expect(cv['event_type_col']).toEqual({ index: 0 });
                expect(cv['allday_type_col']).toEqual({ index: 1 });
            }
        });

        it('כל אייטם יומי שולח רק תאריך (בלי שעה)', async () => {
            const result = await setupHook();
            await act(async () => {
                await result.current.allDay.handleCreateAllDayEvent({
                    type: 0,
                    typeLabel: 'Reserves',
                    date: new Date(2026, 4, 4),
                    durationDays: 1
                });
            });

            const cvs = getAllCreateItemColumnValues();
            expect(cvs[0]['date_col']).toHaveProperty('date');
            // לאירועים יומיים אין שעה — יציבות בין locales
            expect(cvs[0]['date_col']).not.toHaveProperty('time');
        });

        it('אין דליפה של שם המשתמש ב-payload', async () => {
            const result = await setupHook();
            await act(async () => {
                await result.current.allDay.handleCreateAllDayEvent({
                    type: 0,
                    typeLabel: 'Reserves',
                    date: new Date(2026, 4, 4),
                    durationDays: 1
                });
            });

            const cvs = getAllCreateItemColumnValues();
            expect(cvs[0]['event_type_col']).toEqual({ index: 0 });
            expect(cvs[0]['allday_type_col']).toEqual({ index: 0 });
            // reporterId נשלח כ-personsAndTeams, לא שם
            expect(cvs[0]['reporter_col']).toEqual({
                personsAndTeams: [{ id: 7, kind: 'person' }]
            });
            expect(JSON.stringify(cvs[0])).not.toContain('בודק');
        });
    });

    describe('דיווחי שעות מרובים (bulk reports)', () => {
        it('שני דיווחים — יוצר 2 אייטמים, כל אחד עם event_type נכון', async () => {
            const result = await setupHook();
            await act(async () => {
                await result.current.allDay.handleCreateAllDayEvent({
                    type: 'reports',
                    date: new Date(2026, 4, 4),
                    reports: [
                        { isBillable: true, projectId: '500', durationHours: 2 },
                        { isBillable: false, nonBillableType: 'פגישה', durationHours: 1 }
                    ]
                });
            });

            const cvs = getAllCreateItemColumnValues();
            expect(cvs).toHaveLength(2);
            // ראשון — שעתי (3)
            expect(cvs[0]['event_type_col']).toEqual({ index: 3 });
            expect(cvs[0]['project_col']).toEqual({ item_ids: [500] });
            // שני — שוטף (101) + nonBillable label
            expect(cvs[1]['event_type_col']).toEqual({ index: 101 });
            expect(cvs[1]['non_billable_col']).toEqual({ label: 'פגישה' });
        });

        it('round-trip — nonBillable label שנשלח זהה למה שהוזן', async () => {
            const result = await setupHook();
            const userInput = 'הדרכה פנימית';
            await act(async () => {
                await result.current.allDay.handleCreateAllDayEvent({
                    type: 'reports',
                    date: new Date(2026, 4, 4),
                    reports: [
                        { isBillable: false, nonBillableType: userInput, durationHours: 1 }
                    ]
                });
            });

            const cvs = getAllCreateItemColumnValues();
            expect(cvs[0]['non_billable_col'].label).toBe(userInput);
        });
    });

    describe('הגנה כללית — אין תרגומי UI ב-payload', () => {
        it('כל ה-status writes משתמשים ב-shape תקני', async () => {
            const result = await setupHook();
            await act(async () => {
                await result.current.allDay.handleCreateAllDayEvent({
                    type: 0,
                    typeLabel: 'Vacation',
                    date: new Date(2026, 4, 4),
                    durationDays: 1
                });
            });

            const cvs = getAllCreateItemColumnValues();
            const writes = findStatusColumnWrites(cvs[0]);
            expect(writes.length).toBeGreaterThan(0);
            for (const w of writes) {
                expect(['index', 'label']).toContain(w.shape);
            }
        });

        it('אין מחרוזות שנראות כמפתח i18n', async () => {
            const result = await setupHook();
            await act(async () => {
                await result.current.allDay.handleCreateAllDayEvent({
                    type: 1,
                    typeLabel: 'Sick',
                    date: new Date(2026, 4, 4),
                    durationDays: 1
                });
            });

            const cvs = getAllCreateItemColumnValues();
            const TRANSLATIONS_THAT_SHOULD_NEVER_LEAK = [
                'common.save', 'event.type.vacation', 'event.type.sick'
            ];
            expect(() =>
                assertNoForbiddenStrings(cvs[0], TRANSLATIONS_THAT_SHOULD_NEVER_LEAK, { allowedKeys: ['notes_col'] })
            ).not.toThrow();
        });
    });
});
