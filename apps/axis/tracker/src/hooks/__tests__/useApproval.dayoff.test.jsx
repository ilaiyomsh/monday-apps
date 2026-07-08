/**
 * useApproval — guard היעדרויות Day-off ב-approveAllPending (W4.2):
 * אירוע Day-off עם isPending (מדיניות D2 דולקת ב-tracker) לעולם לא נכנס
 * לאישור-כל-הממתינים — הוא read-only ושייך ללוח החופשות, לא לעמודת האישור
 * של לוח הדיווחים. guard מקביל ל-isTemporary הקיים.
 */
import { describe, it, expect, vi } from 'vitest';
import { act, waitFor } from '@testing-library/react';
import { useApproval } from '../useApproval';
import { useSettings } from '../../contexts/SettingsContext';
import { createMondayMock } from '../../test-utils/mondayMock';
import { renderHookWithProviders } from '../../test-utils/renderHookWithProviders';

const TEST_CONTEXT = {
    boardId: 100,
    user: { id: '7', name: 'בודק' }
};

const APPROVAL_SETTINGS = {
    timeReportingBoardId: '100',
    enableApproval: true,
    approvalStatusColumnId: 'approval',
    approvalStatusMapping: { 0: 'pending', 1: 'approved', 2: 'rejected' },
    approvedManagerIds: ['7'],
    lastModifiedAt: '2026-01-01T00:00:00.000Z'
};

const regularPendingEvent = { id: '888', mondayItemId: '888', title: 'דיווח', isPending: true };
const dayOffPendingEvent = {
    id: 'dayoff_71',
    title: 'חופשה',
    isPending: true,
    isDayOff: true,
    readOnly: true,
    allDay: true
};

const mutationCalls = (monday) =>
    monday.api.mock.calls.filter(([query]) =>
        typeof query === 'string' && query.includes('change_multiple_column_values'));

async function setupHook({ events }) {
    const monday = createMondayMock({
        context: TEST_CONTEXT,
        apiResponsesByOp: {
            change_multiple_column_values: { data: { change_multiple_column_values: { id: '888' } } }
        }
    });
    const toasts = {
        showSuccess: vi.fn(),
        showWarning: vi.fn(),
        showErrorWithDetails: vi.fn()
    };
    const { result } = renderHookWithProviders(
        () => ({
            approval: useApproval({
                monday,
                context: TEST_CONTEXT,
                events,
                currentViewRange: null,
                filterRules: [],
                loadEvents: vi.fn(),
                approvalSelection: null,
                toasts,
                t: (key) => key
            }),
            settings: useSettings()
        }),
        { monday, initialContext: TEST_CONTEXT, initialSettings: APPROVAL_SETTINGS }
    );
    await waitFor(() => expect(result.current.settings.isLoading).toBe(false));
    return { result, monday, toasts };
}

describe('useApproval — approveAllInWeek מדלג על היעדרויות Day-off (W4.2)', () => {

    it('אירוע Day-off ממתין לצד דיווח ממתין רגיל — רק הדיווח הרגיל מאושר', async () => {
        const { result, monday, toasts } = await setupHook({
            events: [regularPendingEvent, dayOffPendingEvent]
        });

        await act(async () => {
            await result.current.approval.approveAllInWeek();
        });

        // מוטציה אחת בלבד — עבור הדיווח הרגיל; אפס מוטציות עבור ההיעדרות
        const calls = mutationCalls(monday);
        expect(calls).toHaveLength(1);
        expect(calls[0][0]).toContain('item_id: 888');
        expect(toasts.showSuccess).toHaveBeenCalledTimes(1);
    });

    it('רק אירוע Day-off ממתין — אפס מוטציות והודעת "אין ממתינים"', async () => {
        const { result, monday, toasts } = await setupHook({
            events: [dayOffPendingEvent]
        });

        await act(async () => {
            await result.current.approval.approveAllInWeek();
        });

        expect(mutationCalls(monday)).toHaveLength(0);
        expect(toasts.showWarning).toHaveBeenCalledWith('toasts.noPendingApprovals');
        expect(toasts.showSuccess).not.toHaveBeenCalled();
    });
});
