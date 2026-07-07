import { describe, it, expect, beforeEach } from 'vitest';
import { act, waitFor } from '@testing-library/react';
import { useMondayEvents } from '../useMondayEvents';
import { useSettings } from '../../contexts/SettingsContext';
import { createMondayMock } from '../../test-utils/mondayMock';
import { createApiPayloadCapture } from '../../test-utils/apiPayloadCapture';
import { renderHookWithProviders } from '../../test-utils/renderHookWithProviders';
import { findStatusColumnWrites, assertNoForbiddenStrings } from '../../utils/payloadGuard';

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
    eventTypeLabelMeta: {
        '3': { label: 'שעתי' }, '101': { label: 'שוטף' }
    },
    enableProjectTypeDistinction: false,
    enableApproval: false,
    lastModifiedAt: '2026-01-01T00:00:00.000Z'
};

const TEST_CONTEXT = {
    boardId: 2002,
    user: { id: '7', name: 'בודק' }
};

describe('useMondayEvents — update/drag/delete payload preservation (Phase 2e)', () => {

    let monday;
    let capture;

    beforeEach(() => {
        monday = createMondayMock({
            context: TEST_CONTEXT,
            apiResponses: {
                'change_multiple_column_values': { data: { change_multiple_column_values: { id: '999' } } },
                'change_simple_column_value': { data: { change_simple_column_value: { id: '999' } } },
                'delete_item': { data: { delete_item: { id: '999' } } }
            }
        });
        capture = createApiPayloadCapture(monday);
    });

    async function setupHook() {
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

    /**
     * שולף את ה-column_values מ-mutation של change_multiple_column_values.
     * הקוד בונה inline mutation עם JSON.stringify(JSON.stringify(columnValues))
     * (escape כפול), אז ה-payload מגיע כמחרוזת בתוך ה-mutation עצמה.
     */
    function getChangeColumnsPayload() {
        const call = capture.find(/change_multiple_column_values/);
        expect(call, 'change_multiple_column_values call must be captured').toBeDefined();
        // Mutation inline: ... column_values: "<escaped JSON>"
        const match = call.query.match(/column_values:\s*("(?:[^"\\]|\\.)*")/);
        expect(match, 'column_values literal must be present').toBeTruthy();
        const escaped = JSON.parse(match[1]);
        return JSON.parse(escaped);
    }

    describe('updateEvent (עריכת אירוע קיים)', () => {
        it('שולח event_type כ-{index:N} בעדכון', async () => {
            const result = await setupHook();
            await act(async () => {
                await result.current.events.updateEvent(
                    'item_42',
                    { title: 'דיווח מעודכן', isBillable: true, itemId: '500' },
                    new Date(2026, 4, 4, 10, 0),
                    new Date(2026, 4, 4, 12, 0)
                );
            });

            const cv = getChangeColumnsPayload();
            expect(cv['event_type_col']).toEqual({ index: 3 });
        });

        it('round-trip של nonBillable label בעדכון', async () => {
            const result = await setupHook();
            await act(async () => {
                await result.current.events.updateEvent(
                    'item_42',
                    { title: 't', isBillable: false, nonBillableType: 'הדרכה' },
                    new Date(2026, 4, 4, 10, 0),
                    new Date(2026, 4, 4, 11, 0)
                );
            });

            const cv = getChangeColumnsPayload();
            expect(cv['non_billable_col']).toEqual({ label: 'הדרכה' });
        });
    });

    describe('updateEventPosition — drag/resize של אירוע שעתי', () => {
        it('לא נוגע בעמודות סטטוס (לא משנה event_type)', async () => {
            const result = await setupHook();
            const event = {
                id: 'item_42',
                mondayItemId: 'item_42',
                allDay: false,
                eventTypeIndex: 3,
                eventType: 'שעתי'
            };
            await act(async () => {
                await result.current.events.updateEventPosition(
                    event,
                    new Date(2026, 4, 5, 14, 0),
                    new Date(2026, 4, 5, 16, 0)
                );
            });

            const cv = getChangeColumnsPayload();
            // drag/resize לא צריך לשלוח event_type — המשתמש רק הזיז את האירוע
            expect(cv).not.toHaveProperty('event_type_col');
            expect(cv).not.toHaveProperty('non_billable_col');
            // אבל כן שולח תאריך ומשך
            expect(cv['date_col']).toMatchObject({
                date: expect.any(String),
                time: expect.any(String)
            });
            expect(cv['duration_col']).toMatch(/^\d+\.\d{2}$/);
        });

        it('משך זמן מחושב כשעות עשרוניות ב-2 ספרות', async () => {
            const result = await setupHook();
            const event = { id: 'x', mondayItemId: 'x', allDay: false };
            await act(async () => {
                await result.current.events.updateEventPosition(
                    event,
                    new Date(2026, 4, 5, 9, 0),
                    new Date(2026, 4, 5, 11, 30)
                );
            });

            const cv = getChangeColumnsPayload();
            expect(cv['duration_col']).toBe('2.50');
        });
    });

    describe('updateEventPosition — drag של אירוע יומי', () => {
        it('שולח תאריך בלי שעה (אירוע יומי)', async () => {
            const result = await setupHook();
            const event = {
                id: 'item_50',
                mondayItemId: 'item_50',
                allDay: true,
                eventTypeIndex: 0,
                eventType: 'חופשה'
            };
            await act(async () => {
                await result.current.events.updateEventPosition(
                    event,
                    new Date(2026, 4, 6),
                    new Date(2026, 4, 7) // exclusive end — יום אחד
                );
            });

            const cv = getChangeColumnsPayload();
            expect(cv['date_col']).toHaveProperty('date');
            expect(cv['date_col']).not.toHaveProperty('time');
        });

        it('לא נוגע בעמודות סטטוס באירוע יומי', async () => {
            const result = await setupHook();
            const event = { id: 'x', mondayItemId: 'x', allDay: true, eventTypeIndex: 2 };
            await act(async () => {
                await result.current.events.updateEventPosition(
                    event,
                    new Date(2026, 4, 6),
                    new Date(2026, 4, 8)
                );
            });

            const cv = getChangeColumnsPayload();
            const writes = findStatusColumnWrites(cv);
            expect(writes).toHaveLength(0);
        });
    });

    describe('deleteEvent', () => {
        it('שולח delete_item mutation עם ה-ID', async () => {
            const result = await setupHook();
            await act(async () => {
                await result.current.events.deleteEvent('item_99');
            });

            const call = capture.find(/delete_item/);
            expect(call).toBeDefined();
            expect(call.query).toContain('item_99');
        });
    });

    describe('הגנה כללית — אין תרגומי UI ב-update payload', () => {
        it('updateEvent payload נקי מתרגומים', async () => {
            const result = await setupHook();
            await act(async () => {
                await result.current.events.updateEvent(
                    'item_42',
                    { title: 'דיווח', isBillable: true, itemId: '500', notes: 'הערה' },
                    new Date(2026, 4, 4, 10, 0),
                    new Date(2026, 4, 4, 12, 0)
                );
            });

            const cv = getChangeColumnsPayload();
            const TRANSLATIONS_THAT_SHOULD_NEVER_LEAK = [
                'common.save', 'event.type.hourly', 'Hourly', 'Routine'
            ];
            expect(() =>
                assertNoForbiddenStrings(cv, TRANSLATIONS_THAT_SHOULD_NEVER_LEAK, { allowedKeys: ['notes_col'] })
            ).not.toThrow();
        });
    });
});
