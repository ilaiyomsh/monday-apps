/**
 * A label created in the settings screen can be configured in the SAME visit
 * (owner request, 3.9.0).
 *
 * It could not before: the permissions accordion was rendered only for labels that
 * already had a monday id, because the settings are keyed BY that id and a new label
 * has none until `update_status_column` has run. So creating a label meant saving,
 * re-opening the settings, and only then being able to restrict it — and nothing on
 * the card said so, which read as the accordion being broken.
 *
 * What makes it work is the save order: labels are written first, the refresh tells
 * us which ids monday assigned, and only then are the rules held under the draft's
 * client key ("new:1") moved onto the real id and persisted. This suite pins that
 * end to end, because every part of it is invisible from the outside — the rules
 * land in `monday.storage`, and a key that never got remapped is silently dropped
 * by the prune (`migrateSettings` accepts numeric keys only).
 *
 * The board shape and label ids come from the recorded probe.
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

const TEXT_COLUMN = { id: 'text_1', title: 'הערה', type: 'text', settings: {} };

/** The id monday hands the label created in this test, and the index we sent for it. */
const ASSIGNED_ID = 7;
const NEW_LABEL_INDEX = LIVE_LABELS.length;
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
 * Route by operation, and answer the revision query differently once the label
 * mutation has run — that BEFORE/AFTER difference is the whole mechanism under test.
 */
function installQueryRoutes({ labelsAfterSave }) {
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
      return Promise.resolve(revisionResponse(mutated ? labelsAfterSave : LIVE_LABELS));
    }
    return Promise.resolve({});
  });
}

const labelsWithAssignedId = () => ([
  ...LIVE_LABELS,
  {
    id: ASSIGNED_ID,
    color: 3,
    label: NEW_LABEL_NAME,
    index: NEW_LABEL_INDEX,
    is_done: false,
    is_deactivated: false,
    hex: '#a25ddc',
  },
]);

/** Render, add a label, name it, and hand back its card. */
async function addLabel() {
  render(<ColumnSettings context={CONTEXT} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'הוספת לייבל' })).toBeEnabled());

  fireEvent.click(screen.getByRole('button', { name: 'הוספת לייבל' }));
  const nameInput = screen.getByDisplayValue('לייבל חדש');
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
});

describe('a newly created label can be opened and configured before saving', () => {
  it('offers the permissions accordion on a label that has no id yet', async () => {
    installQueryRoutes({ labelsAfterSave: labelsWithAssignedId() });

    const card = await addLabel();

    // The regression this whole round exists for: the new card used to have an
    // identity row and nothing else.
    expect(within(card).getByRole('button', { name: /הרשאות/ })).toBeEnabled();
  });

  it('saves a required field configured on the new label under the id monday assigned', async () => {
    installQueryRoutes({ labelsAfterSave: labelsWithAssignedId() });

    const card = await addLabel();
    fireEvent.click(within(card).getByRole('button', { name: /הרשאות/ }));
    fireEvent.click(within(card).getByRole('button', { name: /שדות חובה במעבר/ }));
    fireEvent.click(within(card).getByRole('checkbox', { name: TEXT_COLUMN.title }));

    fireEvent.click(screen.getByRole('button', { name: 'שמור' }));
    await waitFor(() => expect(mockSetColumnConfig).toHaveBeenCalledTimes(1));

    // Under the REAL id, with the client key gone: a `new:` key left behind is
    // dropped by the prune, which is what losing the configuration looks like.
    expect(savedSettings().labels[String(ASSIGNED_ID)]).toEqual({
      allowedUserIds: [],
      allowedTeamIds: [],
      requiredColumnIds: [TEXT_COLUMN.id],
      requiredPeopleColumnIds: [],
    });
    expect(Object.keys(savedSettings().labels)).toEqual([String(ASSIGNED_ID)]);
    expect(mockSetColumnConfig).toHaveBeenCalledWith(BOARD_ID, STATUS_COLUMN_ID, savedSettings());
  });

  it('saves the new label as hidden under the id monday assigned', async () => {
    installQueryRoutes({ labelsAfterSave: labelsWithAssignedId() });

    const card = await addLabel();
    fireEvent.click(within(card).getByRole('checkbox', { name: 'מוסתר בבורר' }));

    fireEvent.click(screen.getByRole('button', { name: 'שמור' }));
    await waitFor(() => expect(mockSetColumnConfig).toHaveBeenCalledTimes(1));

    expect(savedSettings().hiddenLabelIds).toEqual([String(ASSIGNED_ID)]);
  });

  it('closes only after the configuration has been persisted', async () => {
    installQueryRoutes({ labelsAfterSave: labelsWithAssignedId() });

    const card = await addLabel();
    fireEvent.click(within(card).getByRole('button', { name: /הרשאות/ }));

    fireEvent.click(screen.getByRole('button', { name: 'שמור' }));
    await waitFor(() => expect(mockCloseAppFeatureModal).toHaveBeenCalledTimes(1));

    expect(mockSetColumnConfig).toHaveBeenCalledTimes(1);
    expect(mockShowNotice).toHaveBeenCalledWith('ההגדרות נשמרו');
  });

  it('writes the labels BEFORE the settings, since the id does not exist before that', async () => {
    installQueryRoutes({ labelsAfterSave: labelsWithAssignedId() });

    const card = await addLabel();
    fireEvent.click(within(card).getByRole('button', { name: /הרשאות/ }));

    fireEvent.click(screen.getByRole('button', { name: 'שמור' }));
    await waitFor(() => expect(mockSetColumnConfig).toHaveBeenCalledTimes(1));

    const mutationCall = mockQuery.mock.calls
      .findIndex(([query]) => query.includes('update_status_column'));
    expect(mutationCall).toBeGreaterThanOrEqual(0);
    // And the refresh that reveals the assigned id came after the mutation.
    const refreshCalls = mockQuery.mock.calls
      .map(([query], index) => (query.includes('GetStatusColumnRevision') ? index : -1))
      .filter((index) => index >= 0);
    expect(refreshCalls.at(-1)).toBeGreaterThan(mutationCall);
  });

  it('says so instead of silently dropping rules it could not re-key', async () => {
    // monday created the label but the refresh shows nothing that matches it — the
    // one case where the remap cannot resolve. The rest of the settings are still
    // saved, and the screen stays open with an explicit message rather than closing
    // on configuration that went nowhere.
    installQueryRoutes({ labelsAfterSave: LIVE_LABELS });

    const card = await addLabel();
    fireEvent.click(within(card).getByRole('button', { name: /הרשאות/ }));
    fireEvent.click(within(card).getByRole('button', { name: /שדות חובה במעבר/ }));
    fireEvent.click(within(card).getByRole('checkbox', { name: TEXT_COLUMN.title }));

    fireEvent.click(screen.getByRole('button', { name: 'שמור' }));

    await waitFor(() => expect(screen.getByText(/ההרשאות של הלייבל החדש לא נשמרו/))
      .toBeInTheDocument());
    expect(mockCloseAppFeatureModal).not.toHaveBeenCalled();
    expect(mockShowNotice).not.toHaveBeenCalled();
  });

  /*
   * The production failure of 3.9.0, from the board it happened on: adding a label
   * came back INVALID_INPUT / "Indexes should be unique" from update_status_column.
   *
   * A label removed EARLIER stays in the column as a deactivated row, invisible in
   * this screen but re-sent in the payload — and the new label took
   * `max(active index) + 1`, which is exactly that row's index when the label removed
   * last was the last in the list. The unit-level rule is pinned in
   * domain/statusLabelDraft.test.js; this is the same failure through the save the
   * user actually performs, asserted on the mutation document that goes out.
   */
  describe('a column that already has a removed label', () => {
    const REMOVED_LABEL = {
      id: 9,
      color: 4,
      label: 'הוסר קודם',
      index: LIVE_LABELS.length,
      is_done: false,
      is_deactivated: true,
      hex: '#784bd1',
    };
    const LIVE_WITH_REMOVED = [...LIVE_LABELS, REMOVED_LABEL];

    /** The new label lands at the position after the actives; the removed row above. */
    const AFTER_SAVE = [
      ...LIVE_LABELS,
      {
        id: ASSIGNED_ID,
        color: 3,
        label: NEW_LABEL_NAME,
        index: LIVE_LABELS.length,
        is_done: false,
        is_deactivated: false,
        hex: '#a25ddc',
      },
      { ...REMOVED_LABEL, index: LIVE_LABELS.length + 1 },
    ];

    const installWithRemoved = () => {
      let mutated = false;
      mockQuery.mockImplementation((query) => {
        if (query.includes('GetBoardSettingsMetadata')) {
          return Promise.resolve({
            boards: [{
              id: BOARD_ID,
              columns: [
                { ...STATUS_COLUMN, settings: { labels: LIVE_WITH_REMOVED } },
                TEXT_COLUMN,
              ],
            }],
            users: [],
          });
        }
        if (query.includes('AccountUsers')) return Promise.resolve({ users: [] });
        if (query.includes('update_status_column')) {
          mutated = true;
          return Promise.resolve({ update_status_column: { id: STATUS_COLUMN_ID } });
        }
        if (query.includes('GetStatusColumnRevision')) {
          return Promise.resolve(revisionResponse(mutated ? AFTER_SAVE : LIVE_WITH_REMOVED));
        }
        return Promise.resolve({});
      });
    };

    const sentIndexes = () => {
      const call = mockQuery.mock.calls.find(([query]) => query.includes('update_status_column'));
      expect(call, 'the labels mutation must have been sent').toBeDefined();
      return [...call[0].matchAll(/index:\s*(\d+)/g)].map((match) => Number(match[1]));
    };

    it('sends every label with a distinct index, so monday does not reject the save', async () => {
      installWithRemoved();

      const card = await addLabel();
      fireEvent.click(within(card).getByRole('button', { name: /הרשאות/ }));

      fireEvent.click(screen.getByRole('button', { name: 'שמור' }));
      await waitFor(() => expect(mockSetColumnConfig).toHaveBeenCalledTimes(1));

      const indexes = sentIndexes();
      // 3 actives + the new one + the removed row, each on its own index.
      expect(indexes).toEqual([0, 1, 2, 3, 4]);
      expect(new Set(indexes).size).toBe(indexes.length);
    });

    it('still re-keys the new label onto its assigned id on such a column', async () => {
      // The partner assertion: the fix renumbers what is SENT, so the draft has to be
      // renumbered too or the index match silently degrades to text-only.
      installWithRemoved();

      const card = await addLabel();
      fireEvent.click(within(card).getByRole('button', { name: /הרשאות/ }));
      fireEvent.click(within(card).getByRole('button', { name: /שדות חובה במעבר/ }));
      fireEvent.click(within(card).getByRole('checkbox', { name: TEXT_COLUMN.title }));

      fireEvent.click(screen.getByRole('button', { name: 'שמור' }));
      await waitFor(() => expect(mockSetColumnConfig).toHaveBeenCalledTimes(1));

      expect(savedSettings().labels[String(ASSIGNED_ID)].requiredColumnIds)
        .toEqual([TEXT_COLUMN.id]);
      expect(screen.queryByText(/ההרשאות של הלייבל החדש לא נשמרו/)).not.toBeInTheDocument();
    });
  });

  it('does not re-create the label when a second save follows a failed one', async () => {
    // The labels mutation already ran, so the draft must be re-seeded from the
    // refresh: without that, the retry sends the same label as new AGAIN and the
    // board ends up with two of them. Storage failing is the cheapest way to force
    // a second save attempt.
    installQueryRoutes({ labelsAfterSave: labelsWithAssignedId() });
    mockSetColumnConfig.mockRejectedValueOnce(new Error('storage down'));

    const card = await addLabel();
    fireEvent.click(within(card).getByRole('button', { name: /הרשאות/ }));

    fireEvent.click(screen.getByRole('button', { name: 'שמור' }));
    await waitFor(() => expect(screen.getByText(/שמירת ההגדרות נכשלה/)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'שמור' }));
    await waitFor(() => expect(mockSetColumnConfig).toHaveBeenCalledTimes(2));

    const mutations = mockQuery.mock.calls.filter(([query]) => query.includes('update_status_column'));
    expect(mutations).toHaveLength(1);
  });
});
