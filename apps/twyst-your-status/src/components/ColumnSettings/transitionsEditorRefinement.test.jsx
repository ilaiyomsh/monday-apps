/**
 * Editor-side refinements from round321's adversarial review — characterization
 * suite (the code exists; the red equivalent is the killed-mutation record):
 *
 * 1. Whether the default (grey) row is a valid transition TARGET derives from the
 *    LIVE column, not the draft name: an id-5 label whose text was cleared
 *    (round313) is still a real label the picker offers, so it must stay
 *    targetable — keying off the name alone silently dropped it from every
 *    restriction.
 * 2. A stored restriction on a column with no other labels was UNCLEARABLE (the
 *    checkboxes are the only writer, and there were none) — the empty state now
 *    carries a "ביטול ההגבלה" action.
 * 3. The save path counts the synthesized default row as active only when it is
 *    real (named now, or live), so prune drops phantom '5' targets left by the
 *    name-then-clear flow.
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
const PROBE_COLUMN = statusColumnProbe.query.boards[0].columns[0];
const STATUS_COLUMN_ID = PROBE_COLUMN.id;
const PROBE_LABELS = PROBE_COLUMN.settings.labels;

/**
 * The round313-supported state: an id-5 label that exists on the column with its
 * text CLEARED. Spread from a captured row (like defaultLabelCard.test.jsx's
 * NAMED_DEFAULT) — same probe-derivation rules, empty label text.
 */
const CLEARED_DEFAULT = {
  ...PROBE_LABELS[0],
  id: 5,
  color: 5,
  label: '',
  index: PROBE_LABELS.length,
  hex: '#c4c4c4',
};

const CONTEXT = {
  boardId: BOARD_ID,
  columnId: STATUS_COLUMN_ID,
  user: { id: '3', currentLanguage: 'he' },
  theme: 'light',
};

function installQueryRoutes(labels) {
  mockQuery.mockImplementation((query) => {
    if (query.includes('GetBoardSettingsMetadata')) {
      return Promise.resolve({
        boards: [{
          id: BOARD_ID,
          columns: [{ ...PROBE_COLUMN, settings: { labels } }],
        }],
        users: [],
      });
    }
    if (query.includes('GetStatusColumnRevision')) {
      return Promise.resolve({
        boards: [{
          id: BOARD_ID,
          columns: [{
            id: STATUS_COLUMN_ID, type: 'status', revision: 'rev-1', settings: { labels },
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
const savedSettings = () => mockSetColumnConfig.mock.calls.at(-1)[2];

async function openTransitions(card) {
  fireEvent.click(within(card).getByRole('button', { name: /הרשאות/ }));
  fireEvent.click(within(card).getByRole('button', { name: /מעברים מותרים/ }));
}

async function renderSettings({ labels, stored = null }) {
  mockUseColumnSettings.mockImplementation(() => ({
    settings: stored, loading: false, error: null, reload: vi.fn(),
  }));
  installQueryRoutes(labels);
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

describe('a LIVE id-5 label with cleared text is still a transition target', () => {
  it('appears in every other card’s checklist, named ברירת מחדל', async () => {
    await renderSettings({ labels: [...PROBE_LABELS, CLEARED_DEFAULT] });
    await openTransitions(cardOf('ממתין'));

    const group = within(cardOf('ממתין')).getByRole('group', { name: /מעברים מותרים/ });
    expect(within(group).getByRole('checkbox', { name: 'ברירת מחדל' })).toBeChecked();
  });

  it('and a restriction stores it, so the picker keeps offering the grey label', async () => {
    await renderSettings({ labels: [...PROBE_LABELS, CLEARED_DEFAULT] });
    await openTransitions(cardOf('ממתין'));

    const group = within(cardOf('ממתין')).getByRole('group', { name: /מעברים מותרים/ });
    fireEvent.click(within(group).getByRole('checkbox', { name: 'נדחה' }));
    fireEvent.click(screen.getByRole('button', { name: 'שמור' }));
    await waitFor(() => expect(mockSetColumnConfig).toHaveBeenCalledTimes(1));

    expect(savedSettings().labels['0'].nextLabelIds).toEqual(['1', '5']);
  });
});

describe('a restriction with no visible targets is still clearable', () => {
  it('offers ביטול ההגבלה on a one-label column and clears the stored rule', async () => {
    await renderSettings({
      labels: [PROBE_LABELS[0]],
      stored: { version: 1, hiddenLabelIds: [], labels: { 0: { nextLabelIds: ['77'] } } },
    });
    await openTransitions(cardOf('ממתין'));

    fireEvent.click(within(cardOf('ממתין')).getByRole('button', { name: 'ביטול ההגבלה' }));
    fireEvent.click(screen.getByRole('button', { name: 'שמור' }));
    await waitFor(() => expect(mockSetColumnConfig).toHaveBeenCalledTimes(1));

    expect('nextLabelIds' in (savedSettings().labels['0'] ?? {})).toBe(false);
  });
});

describe('the save path drops phantom default targets', () => {
  it("prunes '5' out of stored restrictions when the grey label does not really exist", async () => {
    // The probe column has no id-5 label, and nobody names the default card here —
    // so the synthesized row is NOT active, and the stored phantom goes.
    await renderSettings({
      labels: PROBE_LABELS,
      stored: { version: 1, hiddenLabelIds: [], labels: { 0: { nextLabelIds: ['1', '5'] } } },
    });

    fireEvent.click(screen.getByRole('button', { name: 'שמור' }));
    await waitFor(() => expect(mockSetColumnConfig).toHaveBeenCalledTimes(1));

    expect(savedSettings().labels['0'].nextLabelIds).toEqual(['1']);
  });
});
