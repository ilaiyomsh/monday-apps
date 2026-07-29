/**
 * A label created in the settings screen can be configured in the SAME visit
 * (owner request, 3.9.0).
 *
 * It could not before 3.9.0: the permissions accordion was rendered only for labels
 * that already had a monday id, because the settings are keyed BY that id and a new
 * label had none until `update_status_column` had run. So creating a label meant
 * saving, re-opening the settings, and only then being able to restrict it — and
 * nothing on the card said so, which read as the accordion being broken.
 *
 * 3.9.0 made it work by ordering the SAVE: labels first, then a refresh to learn the
 * assigned ids, then the rules held under a draft client key ("new:1") were moved onto
 * the real id. That remap is gone as of this round — the label is now created when the
 * button is clicked, so it carries a real monday id before the accordion is ever
 * opened, and the rules are keyed correctly from the first keystroke. The remap could
 * fail (and had a whole error path for losing rules); nothing here can.
 *
 * This suite keeps guarding the REQUIREMENT rather than the old mechanism: configure a
 * brand-new label without leaving the screen, and have it persist under monday's id.
 * The creation round trip itself is pinned in immediateLabelCreation.test.jsx.
 *
 * The board shape and label ids come from the recorded probe.
 */

import React from 'react';
import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import {
  cleanup, fireEvent, render, screen, waitFor, within,
} from '@testing-library/react';

import statusColumnProbe from '../../test-utils/probes/status-column-context.json';

const mockUseColumnSettings = vi.fn();
const mockQuery = vi.fn();
const mockSetColumnConfig = vi.fn();
const mockShowNotice = vi.fn();
const mockCloseAppFeatureModal = vi.fn();
const mockCloseDialog = vi.fn();

vi.mock('../../hooks/useColumnSettings', () => ({
  default: (...args) => mockUseColumnSettings(...args),
}));

vi.mock('../../services/mondayService', () => ({
  default: {
    query: (...args) => mockQuery(...args),
    setColumnConfig: (...args) => mockSetColumnConfig(...args),
    showNotice: (...args) => mockShowNotice(...args),
    closeAppFeatureModal: (...args) => mockCloseAppFeatureModal(...args),
    closeDialog: (...args) => mockCloseDialog(...args),
  },
}));

vi.mock('../../services/teamsAccess', () => ({
  loadAccountTeams: vi.fn(() => Promise.resolve({ teams: [], teamsAvailable: true })),
}));

const { default: ColumnSettings } = await import('./ColumnSettings.jsx');

const BOARD_ID = statusColumnProbe.query.boards[0].id;
const STATUS_COLUMN = statusColumnProbe.query.boards[0].columns[0];
const STATUS_COLUMN_ID = STATUS_COLUMN.id;
const LIVE_LABELS = STATUS_COLUMN.settings.labels;

const TEXT_COLUMN = {
  id: 'text_1', title: 'הערה', type: 'text', settings: {},
};

/**
 * The probe column holds ids 0,1,2, so the only colour whose id is free is
 * dark_blue — and monday derives the new label's id FROM that colour, hence 3.
 */
const ASSIGNED_ID = 3;
const NEW_LABEL_NAME = 'בבדיקה';

const CONTEXT = {
  boardId: BOARD_ID,
  columnId: STATUS_COLUMN_ID,
  user: { id: '3', currentLanguage: 'he' },
  theme: 'light',
};

const revisionResponse = (labels) => ({
  boards: [{
    id: BOARD_ID,
    columns: [{
      id: STATUS_COLUMN_ID, type: 'status', revision: 'rev-1', settings: { labels },
    }],
  }],
});

/**
 * Route by operation, and answer the revision query differently once a label mutation
 * has run: the creation click is what makes the new label appear.
 */
function installQueryRoutes({ labelsAfterCreate }) {
  let mutated = false;
  mockQuery.mockImplementation((query) => {
    if (query.includes('GetBoardSettingsMetadata')) {
      return Promise.resolve({
        boards: [{ id: BOARD_ID, columns: [STATUS_COLUMN, TEXT_COLUMN] }],
        users: [],
      });
    }
    if (query.includes('AccountUsers')) return Promise.resolve({ users: [] });
    if (query.includes('update_status_column')) {
      mutated = true;
      return Promise.resolve({ update_status_column: { id: STATUS_COLUMN_ID } });
    }
    if (query.includes('GetStatusColumnRevision')) {
      return Promise.resolve(revisionResponse(mutated ? labelsAfterCreate : LIVE_LABELS));
    }
    return Promise.resolve({});
  });
}

const labelsWithAssignedId = () => ([
  ...LIVE_LABELS,
  {
    id: ASSIGNED_ID,
    color: ASSIGNED_ID,
    label: 'לייבל חדש',
    index: LIVE_LABELS.length,
    is_done: false,
    is_deactivated: false,
    hex: '#0086c0',
  },
]);

const toolbarButton = () => screen.getAllByTestId('button')
  .find((button) => button.closest('.twyst-settings-toolbar'));

/** Render, create a label (a real round trip now), name it, and hand back its card. */
async function addLabel() {
  render(<ColumnSettings context={CONTEXT} />);
  await waitFor(() => expect(toolbarButton()).toHaveAttribute('aria-disabled', 'false'));

  fireEvent.click(toolbarButton());
  // The card appears only once monday has answered — that is the point of the change.
  const nameInput = await waitFor(() => screen.getByDisplayValue('לייבל חדש'));
  fireEvent.change(nameInput, { target: { value: NEW_LABEL_NAME } });

  return screen.getByDisplayValue(NEW_LABEL_NAME).closest('article');
}

const savedSettings = () => mockSetColumnConfig.mock.calls.at(-1)[2];

beforeEach(() => {
  mockUseColumnSettings.mockImplementation(() => ({
    settings: null, loading: false, error: null, reload: vi.fn(),
  }));
  mockQuery.mockReset();
  mockSetColumnConfig.mockReset().mockResolvedValue(undefined);
  mockShowNotice.mockReset();
  mockCloseAppFeatureModal.mockReset().mockResolvedValue(undefined);
  mockCloseDialog.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('a newly created label can be opened and configured before saving', () => {
  it('offers the permissions accordion on the freshly created label', async () => {
    installQueryRoutes({ labelsAfterCreate: labelsWithAssignedId() });

    const card = await addLabel();

    // The regression this round exists for: the new card used to have an identity
    // row and nothing else.
    expect(within(card).getByRole('button', { name: /הרשאות/ })).toBeEnabled();
  });

  it('carries monday\'s real id from the moment the card appears, so nothing needs re-keying', async () => {
    installQueryRoutes({ labelsAfterCreate: labelsWithAssignedId() });

    const card = await addLabel();
    fireEvent.click(within(card).getByRole('checkbox', { name: 'מוסתר בבורר' }));
    fireEvent.click(screen.getByRole('button', { name: 'שמור' }));
    await waitFor(() => expect(mockSetColumnConfig).toHaveBeenCalledTimes(1));

    // A `new:`-prefixed key surviving to here is what losing the configuration looked
    // like: the prune drops it, because migrateSettings accepts numeric keys only.
    expect(savedSettings().hiddenLabelIds).toEqual([String(ASSIGNED_ID)]);
    expect(Object.keys(savedSettings().labels).every((key) => /^\d+$/.test(key))).toBe(true);
  });

  it('saves a required field configured on the new label under monday\'s id', async () => {
    installQueryRoutes({ labelsAfterCreate: labelsWithAssignedId() });

    const card = await addLabel();
    fireEvent.click(within(card).getByRole('button', { name: /הרשאות/ }));
    fireEvent.click(within(card).getByRole('button', { name: /שדות חובה במעבר/ }));
    fireEvent.click(within(card).getByRole('checkbox', { name: TEXT_COLUMN.title }));

    fireEvent.click(screen.getByRole('button', { name: 'שמור' }));
    await waitFor(() => expect(mockSetColumnConfig).toHaveBeenCalledTimes(1));

    expect(savedSettings().labels[String(ASSIGNED_ID)]).toEqual({
      allowedUserIds: [],
      allowedTeamIds: [],
      requiredColumnIds: [TEXT_COLUMN.id],
      requiredPeopleColumnIds: [],
    });
    expect(Object.keys(savedSettings().labels)).toEqual([String(ASSIGNED_ID)]);
    expect(mockSetColumnConfig).toHaveBeenCalledWith(BOARD_ID, STATUS_COLUMN_ID, savedSettings());
  });

  it('closes only after the configuration has been persisted', async () => {
    installQueryRoutes({ labelsAfterCreate: labelsWithAssignedId() });

    const card = await addLabel();
    fireEvent.click(within(card).getByRole('button', { name: /הרשאות/ }));

    fireEvent.click(screen.getByRole('button', { name: 'שמור' }));
    await waitFor(() => expect(mockCloseAppFeatureModal).toHaveBeenCalledTimes(1));

    expect(mockSetColumnConfig).toHaveBeenCalledTimes(1);
    expect(mockShowNotice).toHaveBeenCalledWith('ההגדרות נשמרו');
  });

  it('has already written the label to monday before Save is ever pressed', async () => {
    installQueryRoutes({ labelsAfterCreate: labelsWithAssignedId() });

    await addLabel();

    // The ordering 3.9.0 had to arrange inside the save is now structural: the label
    // exists, with its id, before any settings write is even possible.
    expect(mockQuery.mock.calls.some(([query]) => query.includes('update_status_column'))).toBe(true);
    expect(mockSetColumnConfig).not.toHaveBeenCalled();
  });

  it('persists the rename made after creation', async () => {
    installQueryRoutes({ labelsAfterCreate: labelsWithAssignedId() });

    await addLabel();
    fireEvent.click(screen.getByRole('button', { name: 'שמור' }));
    await waitFor(() => expect(mockSetColumnConfig).toHaveBeenCalledTimes(1));

    // The rename is a pending label edit, so the save sends a labels mutation of its
    // own — carrying the new name against the id monday already assigned.
    const renameMutation = mockQuery.mock.calls
      .map(([query]) => query)
      .filter((query) => query.includes('update_status_column'))
      .at(-1);
    expect(renameMutation).toContain(`label: "${NEW_LABEL_NAME}"`);
    expect(renameMutation).toContain(`id: ${ASSIGNED_ID}`);
  });
});
