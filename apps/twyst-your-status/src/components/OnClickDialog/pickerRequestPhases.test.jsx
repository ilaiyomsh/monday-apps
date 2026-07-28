/**
 * The picker's board request no longer waits for the settings read, and these are
 * the holes that opens.
 *
 * The request's column set comes from the settings, so it can now be issued before
 * the settings have arrived — safe, because settings only ever WIDEN it (they add
 * people columns named by a gate). Three things follow, and all three are failure
 * modes rather than slowdowns:
 *
 *  1. Settings that add nothing must not cost a second request. That is the whole
 *     saving; a key that churns spends it.
 *  2. Settings that DO name a gate column must cost a second request that actually
 *     asks for it. Get this wrong and the gate has no data, fails closed, and
 *     silently hides labels the user is allowed to pick — a permissions bug
 *     wearing a performance bug's clothes.
 *  3. The first, narrower run must lose. Landing last it would overwrite the gate
 *     data with a map that lacks the column, and pin the "loaded" key to its own
 *     stale value with no effect left to fire: a permanently blank dialog, boot
 *     overlay already down.
 *
 * The settings are driven through a MUTABLE mock state rather than frozen return
 * values, because every case here is a transition, not a state.
 */

import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';

import { GET_STATUS_COLUMN_CONTEXT } from '../../services/graphqlQueries.js';
import statusColumnProbe from '../../test-utils/probes/status-column-context.json';
import OnClickDialog from './OnClickDialog.jsx';

const mockUseColumnSettings = vi.fn();
const mockQuery = vi.fn();
const mockDismissBootLoader = vi.fn();

vi.mock('../../hooks/useColumnSettings', () => ({
  default: (...args) => mockUseColumnSettings(...args),
}));

vi.mock('../../services/mondayService', () => ({
  default: {
    query: (...args) => mockQuery(...args),
    closeDialog: vi.fn(),
    showNotice: vi.fn(),
    openAppFeatureModal: vi.fn(),
  },
}));

vi.mock('../../services/teamsAccess', () => ({
  loadUserTeamIds: vi.fn(() => Promise.resolve({ teamIds: [] })),
}));

vi.mock('../../utils/bootLoader', () => ({
  BOOT_LOADER_ID: 'twyst-boot-loader',
  dismissBootLoader: (...args) => mockDismissBootLoader(...args),
}));

const STATUS_COLUMN_ID = statusColumnProbe.query.boards[0].columns[0].id;
const GATE_COLUMN_ID = 'people_gate';
const USER_ID = '3';

const CONTEXT = {
  boardId: statusColumnProbe.query.boards[0].id,
  columnId: STATUS_COLUMN_ID,
  itemId: statusColumnProbe.query.items[0].id,
  user: { id: USER_ID, currentLanguage: 'he' },
  theme: 'light',
};

/** The item's current status is index 1, so 1 is never an option. 0 and 2 are. */
const GATED_LABEL_TEXT = 'ממתין'; // label id 0
const UNGATED_LABEL_TEXT = 'נדחה'; // label id 2

/** A people column value that DOES include the acting user. */
const gateColumnValue = () => ({
  id: GATE_COLUMN_ID,
  type: 'people',
  text: 'WZ probe user',
  value: JSON.stringify({ personsAndTeams: [{ id: Number(USER_ID), kind: 'person' }] }),
  column: { id: GATE_COLUMN_ID, title: 'Gate', type: 'people' },
});

/** The recorded probe response, optionally carrying the gate column. */
const boardData = (extraColumnValues = []) => ({
  boards: statusColumnProbe.query.boards,
  items: [{
    ...statusColumnProbe.query.items[0],
    column_values: [...statusColumnProbe.query.items[0].column_values, ...extraColumnValues],
  }],
});

const SETTINGS_LOADING = { settings: null, loading: true, error: null, reload: vi.fn() };

const settingsReady = (settings) => ({
  settings, loading: false, error: null, reload: vi.fn(),
});

/** No rules at all — adds no columns to the request. */
const SETTINGS_NO_GATE = settingsReady({ version: 1, hiddenLabelIds: [], labels: {} });

/** Label 0 is gated on a people column the first request did not ask for. */
const SETTINGS_WITH_GATE = settingsReady({
  version: 1,
  hiddenLabelIds: [],
  labels: {
    0: {
      allowedUserIds: [],
      allowedTeamIds: [],
      requiredColumnIds: [],
      requiredPeopleColumnIds: [GATE_COLUMN_ID],
    },
  },
});

let settingsState = SETTINGS_LOADING;

/** Move the settings hook and re-render, the way a resolved storage read does. */
const landSettings = (next, rerender) => {
  settingsState = next;
  rerender(<OnClickDialog context={CONTEXT} />);
};

const deferred = () => {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
};

/** Let resolved promises and their effects flush. */
const settle = () => new Promise((resolve) => { setTimeout(resolve, 0); });

const columnIdsOf = (callIndex) => mockQuery.mock.calls[callIndex][1].columnIds;

beforeEach(() => {
  settingsState = SETTINGS_LOADING;
  mockUseColumnSettings.mockImplementation(() => settingsState);
  mockQuery.mockReset();
  mockDismissBootLoader.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('picker request phases — the fetch runs beside the settings read', () => {
  it('asks for the status column alone before the settings are in', async () => {
    mockQuery.mockResolvedValue(boardData());

    render(<OnClickDialog context={CONTEXT} />);
    await settle();

    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery).toHaveBeenCalledWith(
      GET_STATUS_COLUMN_CONTEXT,
      expect.objectContaining({
        boardIds: [String(CONTEXT.boardId)],
        itemIds: [String(CONTEXT.itemId)],
        columnIds: [STATUS_COLUMN_ID],
      }),
    );
  });

  it('does NOT refetch when the settings name no new column', async () => {
    // The saving itself. The settings object arriving is not a reason to fetch —
    // only a change to the SET OF COLUMNS is.
    mockQuery.mockResolvedValue(boardData());

    const { rerender } = render(<OnClickDialog context={CONTEXT} />);
    await settle();
    expect(mockQuery).toHaveBeenCalledTimes(1);

    landSettings(SETTINGS_NO_GATE, rerender);
    await waitFor(() => expect(screen.getByText(UNGATED_LABEL_TEXT)).toBeInTheDocument());
    await settle();

    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('refetches WITH the gate column when the settings name one, and the gate then passes', async () => {
    // The mandatory partner to the test above: hard-code the key to [columnId] and
    // that one still passes while people gates quietly stop working. This fails.
    mockQuery
      .mockResolvedValueOnce(boardData())
      .mockResolvedValueOnce(boardData([gateColumnValue()]));

    const { rerender } = render(<OnClickDialog context={CONTEXT} />);
    await settle();

    landSettings(SETTINGS_WITH_GATE, rerender);
    await waitFor(() => expect(mockQuery).toHaveBeenCalledTimes(2));

    expect(columnIdsOf(0)).toEqual([STATUS_COLUMN_ID]);
    expect(columnIdsOf(1)).toEqual([GATE_COLUMN_ID, STATUS_COLUMN_ID].sort());

    // The gate had its data, so the label it guards is offered.
    await waitFor(() => expect(screen.getByText(GATED_LABEL_TEXT)).toBeInTheDocument());
  });

  it('drops a superseded run that resolves last, instead of clobbering the gate data', async () => {
    // Hole 3. Without the run guard this ends as a blank dialog that no further
    // render can repair — and on the way there it hides a label the user may pick.
    const first = deferred();
    const second = deferred();
    mockQuery
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const { rerender } = render(<OnClickDialog context={CONTEXT} />);
    await settle();

    landSettings(SETTINGS_WITH_GATE, rerender);
    await waitFor(() => expect(mockQuery).toHaveBeenCalledTimes(2));

    // The WIDER, current run lands first...
    second.resolve(boardData([gateColumnValue()]));
    await waitFor(() => expect(screen.getByText(GATED_LABEL_TEXT)).toBeInTheDocument());

    // ...and the narrow run it replaced answers afterwards. Its payload has no
    // people column, so writing it would fail the gate closed and hide the label.
    first.resolve(boardData());
    await settle();

    expect(screen.getByText(GATED_LABEL_TEXT)).toBeInTheDocument();
    expect(screen.getByText(UNGATED_LABEL_TEXT)).toBeInTheDocument();
    // Still painted at all: the stale run did not strand the pending key.
    expect(document.querySelector('.status-menu')).not.toBeNull();
  });

  it('holds the boot overlay across the gate-signature change and releases it once', async () => {
    // Between the first response and the second request there is a commit where
    // the old data is in hand but is already known to be insufficient. Releasing
    // there is the one-frame flash the derived pending flag makes unrepresentable.
    mockQuery
      .mockResolvedValueOnce(boardData())
      .mockResolvedValueOnce(boardData([gateColumnValue()]));

    const { rerender } = render(<OnClickDialog context={CONTEXT} />);
    await settle();
    // Settings still loading — nothing may paint, whatever the network did.
    expect(mockDismissBootLoader).not.toHaveBeenCalled();

    landSettings(SETTINGS_WITH_GATE, rerender);
    await waitFor(() => expect(screen.getByText(GATED_LABEL_TEXT)).toBeInTheDocument());
    await settle();

    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(mockDismissBootLoader).toHaveBeenCalledTimes(1);
  });
});
