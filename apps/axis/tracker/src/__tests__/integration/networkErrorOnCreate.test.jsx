/* global globalThis */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, waitFor, screen } from '@testing-library/react';
import { renderCalendar } from '../../test-utils/renderCalendar';
import { mockBoardWithItems, mockProjectsResponse } from '../../test-utils/mondayMock';

/**
 * Behavior tests — NETWORK FAILURE during event save.
 *
 * Contract (error-handling-standard.md §5 "הצגה למשתמש" + the rollout's Phase 2):
 *   A user-initiated SAVE that fails on the network MUST surface an error to the
 *   user and MUST NOT show a "created successfully" toast.
 *
 * These assertions are written from the USER's point of view — what appears on the
 * screen after the save — NOT from the implementation. The same end-to-end create
 * flow as the happy-path test (2.1.1) is driven; only the create_item response is
 * swapped for the three real network-failure shapes the Monday API produces:
 *   (a) a transport rejection ("Failed to fetch"),
 *   (b) a soft GraphQL error (HTTP 200 with an `errors` array),
 *   (c) a 200 response whose item is null with NO errors array.
 *
 * If any of these silently "succeeds" (success toast, no error surface), the test
 * fails — which is exactly the regression this contract must catch.
 */

vi.mock('monday-sdk-js', () => ({ default: () => globalThis.__testMondayMock }));
vi.mock('canvas-confetti', () => ({ default: vi.fn() }));

// User-facing anchors (the contract strings, from src/i18n/locales/he/translation.json):
const SUCCESS_TOAST = 'האירוע נוצר בהצלחה';        // toasts.eventCreated — must NOT appear on failure
const ERROR_TOAST_COPY = 'העתק פרטים';            // ErrorToast copy-details button — present only when an error is surfaced

let originalGetBoundingClientRect;

beforeEach(() => {
    // jsdom returns 0×0 rects; handleCalendarTap needs a height to map clientY → time.
    originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function stub() {
        return { top: 0, left: 0, right: 200, bottom: 1000, width: 200, height: 1000, x: 0, y: 0, toJSON() { return {}; } };
    };
});

afterEach(() => {
    HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    vi.useRealTimers();
    delete globalThis.__testMondayMock;
});

/**
 * Drives the real create flow (tap day cell → pick project → click save) and lets the
 * caller decide what the create_item mutation returns/throws.
 * @param {object|function} createItemResponse — passed to the mock for op `create_item`
 */
async function driveCreateUntilSave(createItemResponse) {
    const projectsResponse = mockProjectsResponse({ boardId: 200, projects: [{ id: '11', name: 'Acme Project' }] });
    const eventsResponse = mockBoardWithItems({ boardId: 100, items: [] });

    const view = await renderCalendar({
        context: { mode: 'mobile' },
        apiResponsesByOp: {
            boards: (query) =>
                (typeof query === 'string' && query.includes('assigned_to_me')) ? projectsResponse : eventsResponse,
            create_item: createItemResponse,
        },
    });

    const daySlot = view.container.querySelector('.rbc-day-slot');
    expect(daySlot).toBeTruthy();
    fireEvent.click(daySlot, { clientY: 60, clientX: 50 });

    const projectButton = await screen.findByRole('button', { name: 'Acme Project' }, { timeout: 10000 });
    fireEvent.click(projectButton);

    const saveButton = await screen.findByRole('button', { name: 'שמור' });
    await waitFor(() => expect(saveButton).not.toBeDisabled());
    fireEvent.click(saveButton);

    return view;
}

describe('Integration — a network failure on event-create surfaces an error, never a false success', () => {
    it('transport rejection (Failed to fetch) → the user sees an error, not "created successfully"', async () => {
        await driveCreateUntilSave(() =>
            Promise.reject(Object.assign(new Error('Failed to fetch'), { name: 'TypeError' }))
        );

        // Desired: an error is surfaced to the user...
        await screen.findByRole('button', { name: ERROR_TOAST_COPY }, { timeout: 10000 });
        // ...and a success toast NEVER appears.
        expect(screen.queryByText(SUCCESS_TOAST)).toBeNull();
    }, 30000);

    it('soft GraphQL error (HTTP 200 + errors[]) → treated as a failure, no false success', async () => {
        await driveCreateUntilSave({
            errors: [{ message: 'no permission to create event', extensions: { code: 'UserUnauthorizedException' } }],
        });

        await screen.findByRole('button', { name: ERROR_TOAST_COPY }, { timeout: 10000 });
        expect(screen.queryByText(SUCCESS_TOAST)).toBeNull();
    }, 30000);

    it('200 response with a null item and no errors array → still not a false success', async () => {
        await driveCreateUntilSave({ data: { create_item: null } });

        await screen.findByRole('button', { name: ERROR_TOAST_COPY }, { timeout: 10000 });
        expect(screen.queryByText(SUCCESS_TOAST)).toBeNull();
    }, 30000);
});
