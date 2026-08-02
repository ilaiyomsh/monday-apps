/**
 * The picker used to explain itself when the CURRENT status was one the admin hid:
 * "הסטטוס הנוכחי נקבע מחוץ לבורר (למשל אוטומציה) ואינו מוצג לבחירה." The owner asked for
 * that sentence to go (round314).
 *
 * It is worth pinning rather than just deleting, for two reasons. The dialog's height is
 * computed from the PILLS alone (`pickerDialogHeightPx` — option 34px, gap 6px, padding
 * 8px, nothing for prose), so a paragraph above them does not get its own space: it eats
 * the last pill's. And the note is easy to reintroduce, since the model still reports
 * `currentIsHidden`.
 *
 * The view-only note is asserted here too, on purpose: it proves the query would FIND a
 * note if one were rendered, so the absence below is a real absence and not a selector
 * that never matches anything.
 *
 * Board shape, label ids, and the item's current status come from the recorded probe.
 */

import React from 'react';
import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import {
  cleanup, render, screen, waitFor,
} from '@testing-library/react';

import statusColumnProbe from '../../test-utils/probes/status-column-context.json';

const mockUseColumnSettings = vi.fn();
const mockQuery = vi.fn();

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
  dismissBootLoader: vi.fn(),
}));

const { default: OnClickDialog } = await import('./OnClickDialog.jsx');

const BOARD = statusColumnProbe.query.boards[0];
const STATUS_COLUMN_ID = BOARD.columns[0].id;
const ITEM = statusColumnProbe.query.items[0];

/** The probe item's current status is label id 1; ids 0 and 2 stay pickable. */
const CURRENT_LABEL_ID = '1';
const PICKABLE_LABEL_TEXT = 'נדחה';

const contextFor = (user) => ({
  boardId: BOARD.id,
  columnId: STATUS_COLUMN_ID,
  itemId: ITEM.id,
  user: { id: '3', currentLanguage: 'he', ...user },
  theme: 'light',
});

/** Settings that HIDE the status the item currently holds — the note's old trigger. */
const SETTINGS_HIDING_CURRENT = {
  settings: { version: 1, hiddenLabelIds: [CURRENT_LABEL_ID], labels: {} },
  loading: false,
  error: null,
  reload: vi.fn(),
};

const noteTexts = () => Array.from(document.querySelectorAll('.status-picker-note'))
  .map((node) => node.textContent.trim());

beforeEach(() => {
  mockUseColumnSettings.mockImplementation(() => SETTINGS_HIDING_CURRENT);
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ boards: statusColumnProbe.query.boards, items: [ITEM] });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('the picker when the current status is hidden from it', () => {
  it('says nothing about the status having been set outside the picker', async () => {
    render(<OnClickDialog context={contextFor()} />);
    await waitFor(() => expect(screen.getByText(PICKABLE_LABEL_TEXT)).toBeInTheDocument());

    expect(screen.queryByText(/נקבע מחוץ לבורר/)).toBeNull();
    expect(noteTexts()).toEqual([]);
  });

  it('still offers every label the user may pick', async () => {
    // Removing the sentence must not remove anything else from the dialog: the two
    // labels that are neither current nor hidden are still the whole point of it.
    render(<OnClickDialog context={contextFor()} />);
    await waitFor(() => expect(screen.getByText(PICKABLE_LABEL_TEXT)).toBeInTheDocument());

    expect(screen.getAllByRole('option').map((node) => node.textContent))
      .toEqual(['ממתין', 'נדחה']);
  });

  it('still shows the view-only note, so the absence above is a real absence', async () => {
    render(<OnClickDialog context={contextFor({ isViewOnly: true })} />);
    await waitFor(() => expect(screen.getByText(PICKABLE_LABEL_TEXT)).toBeInTheDocument());

    expect(noteTexts()).toEqual(['יש לך הרשאת צפייה בלבד ולכן לא ניתן לשנות את הסטטוס.']);
  });
});
