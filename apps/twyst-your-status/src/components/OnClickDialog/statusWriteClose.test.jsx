/**
 * Neither surface closes until the status has actually changed (owner rule, 3.9.0).
 *
 * The picker and the fill form are the two ways a status gets written, and in both
 * the CLOSE is the only confirmation the user gets — there is no success toast. So
 * the ordering is a product guarantee, not an implementation detail:
 *
 *   click → surface stays open with a loader → the write comes back → close
 *
 * Two failure modes this pins, both invisible without it:
 *
 *  1. Closing while the request is in flight. `closeDialog` / `closeAppFeatureModal`
 *     tear the iframe down, and the browser cancels a request still in flight — the
 *     user watches the surface close on a status that was never written.
 *  2. Closing on a response that did not do what was asked. `change_column_value`
 *     can come back `null`, or echo a different label, inside a 200 with no
 *     `errors` — a bare `await` cannot tell that from a success. Both mutations now
 *     echo the status column back and the echo is checked before closing
 *     (domain/statusWriteResult.js).
 *
 * Board data and label ids come from the recorded probes, not hand-built objects.
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import statusColumnProbe from '../../test-utils/probes/status-column-context.json';
import requiredFieldsProbe from '../../test-utils/probes/required-field-values.json';

const mockUseColumnSettings = vi.fn();
const mockQuery = vi.fn();
const mockCloseDialog = vi.fn();
const mockCloseAppFeatureModal = vi.fn();
const mockShowNotice = vi.fn();

vi.mock('../../hooks/useColumnSettings', () => ({
  default: (...args) => mockUseColumnSettings(...args),
}));

vi.mock('../../services/mondayService', () => ({
  default: {
    query: (...args) => mockQuery(...args),
    closeDialog: (...args) => mockCloseDialog(...args),
    closeAppFeatureModal: (...args) => mockCloseAppFeatureModal(...args),
    showNotice: (...args) => mockShowNotice(...args),
    openAppFeatureModal: vi.fn(),
  },
}));

vi.mock('../../services/teamsAccess', () => ({
  loadUserTeamIds: vi.fn(() => Promise.resolve({ teamIds: [] })),
  loadAccountTeams: vi.fn(() => Promise.resolve({ teams: [], teamsAvailable: true })),
}));

vi.mock('../../utils/bootLoader', () => ({
  BOOT_LOADER_ID: 'twyst-boot-loader',
  dismissBootLoader: vi.fn(),
}));

const { default: OnClickDialog } = await import('./OnClickDialog.jsx');
const { default: RequiredFieldsModal } = await import('./RequiredFieldsModal.jsx');

const BOARD = statusColumnProbe.query.boards[0];
const STATUS_COLUMN = BOARD.columns[0];
const STATUS_COLUMN_ID = STATUS_COLUMN.id;
const ITEM = statusColumnProbe.query.items[0];

/** The item's current status is label 1, so 1 is never offered. 0 and 2 are. */
const PICKED_LABEL_ID = '2';
const PICKED_LABEL_TEXT = 'נדחה';
const OTHER_LABEL_ID = '0';

const CHECKBOX_CELL = requiredFieldsProbe.data.items[0].column_values
  .find((value) => value.column.type === 'checkbox');

const CONTEXT = {
  boardId: BOARD.id,
  columnId: STATUS_COLUMN_ID,
  itemId: ITEM.id,
  user: { id: '3', currentLanguage: 'he' },
  theme: 'light',
};

const NO_RULES = { version: 1, hiddenLabelIds: [], labels: {} };

const REQUIRED_CHECKBOX = {
  version: 1,
  hiddenLabelIds: [],
  labels: {
    [PICKED_LABEL_ID]: {
      allowedUserIds: [],
      allowedTeamIds: [],
      requiredColumnIds: [CHECKBOX_CELL.column.id],
      requiredPeopleColumnIds: [],
    },
  },
};

const settingsReady = (settings) => ({
  settings, loading: false, error: null, reload: vi.fn(),
});

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

/** Let resolved promises and their effects flush. */
const settle = () => new Promise((resolve) => { setTimeout(resolve, 0); });

/** What monday returns from a status write: `index` carries the label id. */
const statusColumnEcho = (labelId) => ([{
  id: STATUS_COLUMN_ID,
  index: Number(labelId),
  label: labelId === PICKED_LABEL_ID ? PICKED_LABEL_TEXT : 'ממתין',
  value: JSON.stringify({ index: Number(labelId) }),
}]);

const boardData = () => ({ boards: BOARD ? [BOARD] : [], items: [ITEM] });

const requiredFieldsData = () => ({
  boards: [{ id: BOARD.id, columns: [STATUS_COLUMN] }],
  items: [{ id: ITEM.id, name: ITEM.name, column_values: [CHECKBOX_CELL] }],
});

/**
 * Route each call by the operation in it, so a changed call ORDER cannot silently
 * feed a response to the wrong request.
 */
function routeQuery({ write }) {
  return (query) => {
    if (query.includes('change_column_value')) return write();
    if (query.includes('change_multiple_column_values')) return write();
    if (query.includes('GetRequiredFieldsContext')) return Promise.resolve(requiredFieldsData());
    return Promise.resolve(boardData());
  };
}

const renderModal = () => {
  window.history.replaceState({}, '', `/required-fields?boardId=${BOARD.id}`
    + `&columnId=${STATUS_COLUMN_ID}&itemId=${ITEM.id}&labelId=${PICKED_LABEL_ID}`);
  return render(<RequiredFieldsModal context={CONTEXT} />);
};

beforeEach(() => {
  mockQuery.mockReset();
  mockCloseDialog.mockReset().mockResolvedValue(undefined);
  mockCloseAppFeatureModal.mockReset().mockResolvedValue(undefined);
  mockShowNotice.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('the picker closes only on a confirmed status write', () => {
  beforeEach(() => {
    mockUseColumnSettings.mockImplementation(() => settingsReady(NO_RULES));
  });

  const clickPickedLabel = () => fireEvent.click(screen.getByText(PICKED_LABEL_TEXT));

  it('stays open with the picked pill spinning while the write is in flight', async () => {
    const write = deferred();
    mockQuery.mockImplementation(routeQuery({ write: () => write.promise }));

    render(<OnClickDialog context={CONTEXT} />);
    await waitFor(() => expect(screen.getByText(PICKED_LABEL_TEXT)).toBeInTheDocument());
    clickPickedLabel();
    await settle();

    // Open, and visibly working: the pill that was clicked owns the spinner and
    // every pill is blocked, so a second click cannot start a second write.
    expect(mockCloseDialog).not.toHaveBeenCalled();
    const picked = screen.getByText(PICKED_LABEL_TEXT).closest('button');
    expect(picked).toHaveAttribute('aria-busy', 'true');
    expect(picked.querySelector('.status-option-spinner')).not.toBeNull();
    screen.getAllByRole('option').forEach((option) => expect(option).toBeDisabled());

    write.resolve({ change_column_value: { id: ITEM.id, column_values: statusColumnEcho(PICKED_LABEL_ID) } });
    await waitFor(() => expect(mockCloseDialog).toHaveBeenCalledTimes(1));
  });

  it('does not close when monday echoes a different status than the one picked', async () => {
    // A 200 with no `errors` whose echo says the status is something else. Closing
    // here drops the dialog on a change that did not happen.
    mockQuery.mockImplementation(routeQuery({
      write: () => Promise.resolve({
        change_column_value: { id: ITEM.id, column_values: statusColumnEcho(OTHER_LABEL_ID) },
      }),
    }));

    render(<OnClickDialog context={CONTEXT} />);
    await waitFor(() => expect(screen.getByText(PICKED_LABEL_TEXT)).toBeInTheDocument());
    clickPickedLabel();

    await waitFor(() => expect(screen.getByText(/הסטטוס לא עודכן/)).toBeInTheDocument());
    expect(mockCloseDialog).not.toHaveBeenCalled();
  });

  it('does not close when the mutation comes back without an item', async () => {
    mockQuery.mockImplementation(routeQuery({
      write: () => Promise.resolve({ change_column_value: null }),
    }));

    render(<OnClickDialog context={CONTEXT} />);
    await waitFor(() => expect(screen.getByText(PICKED_LABEL_TEXT)).toBeInTheDocument());
    clickPickedLabel();

    await waitFor(() => expect(screen.getByText(/הסטטוס לא עודכן/)).toBeInTheDocument());
    expect(mockCloseDialog).not.toHaveBeenCalled();
  });

  it('does not close when the write fails outright', async () => {
    mockQuery.mockImplementation(routeQuery({
      write: () => Promise.reject(new Error('ColumnValueException')),
    }));

    render(<OnClickDialog context={CONTEXT} />);
    await waitFor(() => expect(screen.getByText(PICKED_LABEL_TEXT)).toBeInTheDocument());
    clickPickedLabel();

    await waitFor(() => expect(screen.getByText('ColumnValueException')).toBeInTheDocument());
    expect(mockCloseDialog).not.toHaveBeenCalled();
  });

  it('asks monday to echo the status column back, or there is nothing to confirm', async () => {
    mockQuery.mockImplementation(routeQuery({
      write: () => Promise.resolve({
        change_column_value: { id: ITEM.id, column_values: statusColumnEcho(PICKED_LABEL_ID) },
      }),
    }));

    render(<OnClickDialog context={CONTEXT} />);
    await waitFor(() => expect(screen.getByText(PICKED_LABEL_TEXT)).toBeInTheDocument());
    clickPickedLabel();
    await waitFor(() => expect(mockCloseDialog).toHaveBeenCalledTimes(1));

    const writeCall = mockQuery.mock.calls.find(([query]) => query.includes('change_column_value'));
    expect(writeCall[0]).toMatch(/column_values\(ids:\s*\[\$columnId\]\)/);
    expect(writeCall[0]).toMatch(/on StatusValue/);
  });
});

describe('the required-fields form closes only on a confirmed status write', () => {
  beforeEach(() => {
    mockUseColumnSettings.mockImplementation(() => settingsReady(REQUIRED_CHECKBOX));
  });

  const submit = () => fireEvent.click(screen.getByRole('button', { name: /שמור|שומר/ }));

  it('stays open with a spinner on the button while the write is in flight', async () => {
    const write = deferred();
    mockQuery.mockImplementation(routeQuery({ write: () => write.promise }));

    renderModal();
    await waitFor(() => expect(screen.getByText('עמודות חובה')).toBeInTheDocument());
    submit();
    await settle();

    expect(mockCloseAppFeatureModal).not.toHaveBeenCalled();
    const button = screen.getByRole('button', { name: /שומר/ });
    expect(button).toBeDisabled();
    expect(button.querySelector('.twyst-btn-spinner')).not.toBeNull();

    write.resolve({
      change_multiple_column_values: { id: ITEM.id, column_values: statusColumnEcho(PICKED_LABEL_ID) },
    });
    await waitFor(() => expect(mockCloseAppFeatureModal).toHaveBeenCalledTimes(1));
  });

  it('does not close when monday echoes a different status than the one submitted', async () => {
    mockQuery.mockImplementation(routeQuery({
      write: () => Promise.resolve({
        change_multiple_column_values: { id: ITEM.id, column_values: statusColumnEcho(OTHER_LABEL_ID) },
      }),
    }));

    renderModal();
    await waitFor(() => expect(screen.getByText('עמודות חובה')).toBeInTheDocument());
    submit();

    await waitFor(() => expect(screen.getByText(/הסטטוס לא עודכן/)).toBeInTheDocument());
    expect(mockCloseAppFeatureModal).not.toHaveBeenCalled();
    expect(mockCloseDialog).not.toHaveBeenCalled();
    // The form is still there to retry from — not replaced by an error screen.
    expect(screen.getByRole('button', { name: /שמור/ })).toBeInTheDocument();
  });

  it('does not close when the mutation comes back without an item', async () => {
    mockQuery.mockImplementation(routeQuery({
      write: () => Promise.resolve({ change_multiple_column_values: null }),
    }));

    renderModal();
    await waitFor(() => expect(screen.getByText('עמודות חובה')).toBeInTheDocument());
    submit();

    await waitFor(() => expect(screen.getByText(/הסטטוס לא עודכן/)).toBeInTheDocument());
    expect(mockCloseAppFeatureModal).not.toHaveBeenCalled();
  });

  it('asks monday to echo the status column back in the multi-column write', async () => {
    mockQuery.mockImplementation(routeQuery({
      write: () => Promise.resolve({
        change_multiple_column_values: { id: ITEM.id, column_values: statusColumnEcho(PICKED_LABEL_ID) },
      }),
    }));

    renderModal();
    await waitFor(() => expect(screen.getByText('עמודות חובה')).toBeInTheDocument());
    submit();
    await waitFor(() => expect(mockCloseAppFeatureModal).toHaveBeenCalledTimes(1));

    const writeCall = mockQuery.mock.calls
      .find(([query]) => query.includes('change_multiple_column_values'));
    expect(writeCall[0]).toMatch(/column_values\(ids:\s*\[\$statusColumnId\]\)/);
    expect(writeCall[1].statusColumnId).toBe(STATUS_COLUMN_ID);
  });
});
