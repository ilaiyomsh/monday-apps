/**
 * The transitions editor — round321 (owner request): every label card configures
 * which labels may be picked AFTER it. The domain contract (rule.nextLabelIds,
 * the reserved '5' source for an empty status, composition with hiding and
 * allowlists) is pinned in src/domain/statusTransitions.test.js; this suite pins
 * the EDITOR: what the card offers, and what a save actually stores.
 *
 * The board shape and label ids come from the recorded probe (ids 0,1,2; no id 5 —
 * the default label was never named on this column).
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

vi.mock('../../hooks/useColumnSettings', () => ({
  default: (...args) => mockUseColumnSettings(...args),
}));

vi.mock('../../services/mondayService', () => ({
  default: {
    query: (...args) => mockQuery(...args),
    setColumnConfig: (...args) => mockSetColumnConfig(...args),
    showNotice: (...args) => mockShowNotice(...args),
    closeAppFeatureModal: vi.fn(() => Promise.resolve()),
    closeDialog: vi.fn(() => Promise.resolve()),
  },
}));

vi.mock('../../services/teamsAccess', () => ({
  loadAccountTeams: vi.fn(() => Promise.resolve({ teams: [], teamsAvailable: true })),
}));

const { default: ColumnSettings } = await import('./ColumnSettings.jsx');

const BOARD_ID = statusColumnProbe.query.boards[0].id;
const STATUS_COLUMN = statusColumnProbe.query.boards[0].columns[0];
const STATUS_COLUMN_ID = STATUS_COLUMN.id;
/** ממתין(0) / מאושר אוטומטית(1) / נדחה(2) — and no default label on the column. */
const LIVE_LABELS = STATUS_COLUMN.settings.labels;

const CONTEXT = {
  boardId: BOARD_ID,
  columnId: STATUS_COLUMN_ID,
  user: { id: '3', currentLanguage: 'he' },
  theme: 'light',
};

function installQueryRoutes() {
  mockQuery.mockImplementation((query) => {
    if (query.includes('GetBoardSettingsMetadata')) {
      return Promise.resolve({
        boards: [{ id: BOARD_ID, columns: [STATUS_COLUMN] }],
        users: [],
      });
    }
    if (query.includes('GetStatusColumnRevision')) {
      return Promise.resolve({
        boards: [{
          id: BOARD_ID,
          columns: [{
            id: STATUS_COLUMN_ID, type: 'status', revision: 'rev-1', settings: { labels: LIVE_LABELS },
          }],
        }],
      });
    }
    if (query.includes('update_status_column')) {
      return Promise.resolve({ update_status_column: { id: STATUS_COLUMN_ID } });
    }
    return Promise.resolve({});
  });
}

const cardOf = (name) => screen.getByDisplayValue(name).closest('article');
const defaultCard = () => screen.getByLabelText('שם לייבל ברירת המחדל').closest('article');

/** Open a card's accordion, then its transitions section, and return the group. */
async function openTransitions(card) {
  fireEvent.click(within(card).getByRole('button', { name: /הרשאות/ }));
  fireEvent.click(within(card).getByRole('button', { name: /מעברים מותרים/ }));
  return waitFor(() => within(card).getByRole('group', { name: /מעברים מותרים/ }));
}

const savedSettings = () => mockSetColumnConfig.mock.calls.at(-1)[2];

async function renderSettings(storedSettings = null) {
  mockUseColumnSettings.mockImplementation(() => ({
    settings: storedSettings, loading: false, error: null, reload: vi.fn(),
  }));
  installQueryRoutes();
  render(<ColumnSettings context={CONTEXT} />);
  await waitFor(() => expect(screen.getByDisplayValue('ממתין')).toBeInTheDocument());
}

beforeEach(() => {
  mockQuery.mockReset();
  mockSetColumnConfig.mockReset().mockResolvedValue(undefined);
  mockShowNotice.mockReset();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('what the transitions section offers', () => {
  it('lists every OTHER label, all checked when nothing was restricted', async () => {
    await renderSettings();
    const group = await openTransitions(cardOf('ממתין'));

    const boxes = within(group).getAllByRole('checkbox');
    expect(boxes.map((box) => box.getAttribute('aria-label')))
      .toEqual(['מאושר אוטומטית', 'נדחה']);
    boxes.forEach((box) => expect(box).toBeChecked());
  });

  it('does NOT offer the unnamed default label as a target — it is not on the column', async () => {
    await renderSettings();
    const group = await openTransitions(cardOf('ממתין'));

    expect(within(group).getAllByRole('checkbox')).toHaveLength(2);
    expect(within(group).queryByRole('checkbox', { name: /ברירת מחדל/ })).toBeNull();
  });

  it('the default (grey) card configures the EMPTY status: its section offers every real label', async () => {
    await renderSettings();
    const group = await openTransitions(defaultCard());

    expect(within(group).getAllByRole('checkbox').map((box) => box.getAttribute('aria-label')))
      .toEqual(['ממתין', 'מאושר אוטומטית', 'נדחה']);
  });

  it('reflects a stored restriction: only the listed labels are checked', async () => {
    await renderSettings({
      version: 1,
      hiddenLabelIds: [],
      labels: { 0: { nextLabelIds: ['2'] } },
    });
    const group = await openTransitions(cardOf('ממתין'));

    expect(within(group).getByRole('checkbox', { name: 'נדחה' })).toBeChecked();
    expect(within(group).getByRole('checkbox', { name: 'מאושר אוטומטית' })).not.toBeChecked();
  });
});

describe('what a save stores', () => {
  it('stores the remaining targets when one is unchecked', async () => {
    await renderSettings();
    const group = await openTransitions(cardOf('ממתין'));

    fireEvent.click(within(group).getByRole('checkbox', { name: 'מאושר אוטומטית' }));
    fireEvent.click(screen.getByRole('button', { name: 'שמור' }));
    await waitFor(() => expect(mockSetColumnConfig).toHaveBeenCalledTimes(1));

    expect(savedSettings().labels['0'].nextLabelIds).toEqual(['2']);
  });

  it('stores NO nextLabelIds field while everything stays checked — old blobs stay byte-compatible', async () => {
    await renderSettings();
    await openTransitions(cardOf('ממתין'));

    fireEvent.click(screen.getByRole('button', { name: 'שמור' }));
    await waitFor(() => expect(mockSetColumnConfig).toHaveBeenCalledTimes(1));

    const rules = savedSettings().labels;
    Object.values(rules).forEach((rule) => expect('nextLabelIds' in rule).toBe(false));
  });

  it('re-checking everything REMOVES the restriction rather than storing the full list', async () => {
    await renderSettings({
      version: 1,
      hiddenLabelIds: [],
      labels: { 0: { nextLabelIds: ['2'] } },
    });
    const group = await openTransitions(cardOf('ממתין'));

    fireEvent.click(within(group).getByRole('checkbox', { name: 'מאושר אוטומטית' }));
    fireEvent.click(screen.getByRole('button', { name: 'שמור' }));
    await waitFor(() => expect(mockSetColumnConfig).toHaveBeenCalledTimes(1));

    expect('nextLabelIds' in (savedSettings().labels['0'] ?? {})).toBe(false);
  });

  it('unchecking EVERYTHING stores an empty list — a terminal status is a real choice', async () => {
    await renderSettings();
    const group = await openTransitions(cardOf('נדחה'));

    fireEvent.click(within(group).getByRole('checkbox', { name: 'ממתין' }));
    fireEvent.click(within(group).getByRole('checkbox', { name: 'מאושר אוטומטית' }));
    fireEvent.click(screen.getByRole('button', { name: 'שמור' }));
    await waitFor(() => expect(mockSetColumnConfig).toHaveBeenCalledTimes(1));

    expect(savedSettings().labels['2'].nextLabelIds).toEqual([]);
  });

  it("a restriction set on the DEFAULT card is stored under the reserved id '5'", async () => {
    await renderSettings();
    const group = await openTransitions(defaultCard());

    fireEvent.click(within(group).getByRole('checkbox', { name: 'נדחה' }));
    fireEvent.click(screen.getByRole('button', { name: 'שמור' }));
    await waitFor(() => expect(mockSetColumnConfig).toHaveBeenCalledTimes(1));

    expect(savedSettings().labels['5'].nextLabelIds).toEqual(['0', '1']);
  });
});

describe('the collapsed card tells the admin a restriction exists', () => {
  it('shows a transitions count chip only when the label is restricted', async () => {
    await renderSettings({
      version: 1,
      hiddenLabelIds: [],
      labels: { 0: { nextLabelIds: ['2'] } },
    });

    expect(within(cardOf('ממתין')).getByText(/מעברים: 1/)).toBeInTheDocument();
    expect(within(cardOf('נדחה')).queryByText(/מעברים/)).toBeNull();
  });
});
