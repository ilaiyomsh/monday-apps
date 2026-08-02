/**
 * The default (grey) label's card — round 313, owner request: set the text of monday's
 * empty status from here, exactly as a normal status column allows.
 *
 * The rules this pins come from the live API (probed 2026-07 in the sandbox, boards
 * deleted): the grey label is the `explosive` one, monday gives it id 5 and forces hex
 * #c4c4c4; a fresh column does not have it at all; renaming and clearing to `""` both
 * work through the same `update_status_column` the app already uses; and a label created
 * in that slot can never be deleted.
 *
 * So the card is always on screen, it is the only one with no colour picker and no
 * remove button, an empty name is legal there and ONLY there — and an empty one that
 * monday does not already have is never written, because writing it would hand the admin
 * an undeletable label they never asked for.
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
/** ids 0,1,2 and no id 5 — the probe column has never had a default label. */
const LIVE_LABELS = STATUS_COLUMN.settings.labels;
/** The same column after somebody named the grey label. monday reports it grey. */
const NAMED_DEFAULT = {
  id: 5, color: 5, label: 'טרם עודכן', index: 3, is_done: false, is_deactivated: false, hex: '#c4c4c4',
};

const CONTEXT = {
  boardId: BOARD_ID,
  columnId: STATUS_COLUMN_ID,
  user: { id: '3', currentLanguage: 'he' },
  theme: 'light',
};

const mutationsSent = () => mockQuery.mock.calls
  .filter(([query]) => query.includes('update_status_column'))
  .map(([query]) => query);

function installQueryRoutes({ labels = LIVE_LABELS } = {}) {
  mockQuery.mockImplementation((query) => {
    if (query.includes('GetBoardSettingsMetadata')) {
      return Promise.resolve({
        boards: [{
          id: BOARD_ID,
          columns: [{ ...STATUS_COLUMN, settings: { labels } }],
        }],
        users: [],
      });
    }
    if (query.includes('update_status_column')) {
      return Promise.resolve({ update_status_column: { id: STATUS_COLUMN_ID } });
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
    return Promise.resolve({});
  });
}

const defaultInput = () => screen.getByLabelText('שם לייבל ברירת המחדל');
const defaultCard = () => defaultInput().closest('article');
const saveButton = () => screen.getByRole('button', { name: 'שמור' });

async function renderSettings(options) {
  installQueryRoutes(options);
  render(<ColumnSettings context={CONTEXT} />);
  await waitFor(() => expect(defaultInput()).toBeInTheDocument());
}

beforeEach(() => {
  mockUseColumnSettings.mockImplementation(() => ({
    settings: null, loading: false, error: null, reload: vi.fn(),
  }));
  mockQuery.mockReset();
  mockSetColumnConfig.mockReset();
  mockSetColumnConfig.mockResolvedValue(undefined);
  mockShowNotice.mockReset();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('the default label card', () => {
  it('is shown empty and last even on a column monday never gave a default label', async () => {
    await renderSettings();

    const cards = screen.getAllByRole('article');
    expect(cards).toHaveLength(LIVE_LABELS.length + 1);
    expect(cards[cards.length - 1]).toBe(defaultCard());
    expect(defaultInput()).toHaveValue('');
    // The coloured labels are all still there, in their own order.
    expect(cards.slice(0, 3).map((card) => within(card).getByLabelText('שם הלייבל').value))
      .toEqual(['ממתין', 'מאושר אוטומטית', 'נדחה']);
  });

  it('shows monday\'s grey with no colour picker and no way to delete it', async () => {
    await renderSettings();
    const card = defaultCard();

    const swatch = card.querySelector('.twyst-color-circle');
    expect(swatch).toHaveStyle({ background: '#c4c4c4' });
    // A readout, not a control: monday overrides the colour, so offering a picker here
    // would be a control that lies.
    expect(swatch.tagName).toBe('SPAN');
    expect(within(card).queryByRole('button', { name: 'הסרה' })).toBeNull();
    expect(within(card).queryByRole('button', { name: 'הזז למעלה' })).toBeNull();
    expect(within(card).queryByRole('button', { name: 'הזז למטה' })).toBeNull();
    // …while an ordinary label keeps all three.
    const coloured = screen.getByDisplayValue('ממתין').closest('article');
    expect(within(coloured).getByRole('button', { name: 'הסרה' })).toBeInTheDocument();
    expect(coloured.querySelector('.twyst-color-circle').tagName).toBe('BUTTON');
  });

  it('reads the existing default label off the column', async () => {
    await renderSettings({ labels: [...LIVE_LABELS, NAMED_DEFAULT] });

    expect(defaultInput()).toHaveValue('טרם עודכן');
    expect(screen.getAllByRole('article')).toHaveLength(LIVE_LABELS.length + 1);
  });

  it('writes NO label mutation when it is left empty', async () => {
    // The label cannot be deleted once created. An admin who never typed in this box
    // must not end up owning one.
    await renderSettings();
    fireEvent.click(saveButton());

    await waitFor(() => expect(mockSetColumnConfig).toHaveBeenCalled());
    expect(mutationsSent()).toEqual([]);
    expect(screen.queryByText('לכל לייבל חייב להיות שם.')).toBeNull();
  });

  it('creates it with colour explosive and no id once a name is typed', async () => {
    await renderSettings();
    fireEvent.change(defaultInput(), { target: { value: 'טרם עודכן' } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(mutationsSent()).toHaveLength(1));
    const [mutation] = mutationsSent();
    // No id — monday derives id 5 from the colour. And it goes last, where it shows.
    expect(mutation).toMatch(/\{ color: explosive, label: "טרם עודכן", index: 3 \}/);
    // The coloured labels are resent with their own ids: an omitted label is a DELETE.
    expect(mutation).toContain('id: 0');
    expect(mutation).toContain('id: 1');
    expect(mutation).toContain('id: 2');
  });

  it('clears an existing default label to an empty string under id 5', async () => {
    await renderSettings({ labels: [...LIVE_LABELS, NAMED_DEFAULT] });
    fireEvent.change(defaultInput(), { target: { value: '' } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(mutationsSent()).toHaveLength(1));
    // Cleared, not removed: the row stays on the column, with no text.
    expect(mutationsSent()[0]).toMatch(/id: 5, color: explosive, label: ""/);
  });

  it('still refuses to save a COLOURED label with no name', async () => {
    await renderSettings();
    fireEvent.change(screen.getByDisplayValue('ממתין'), { target: { value: '  ' } });
    fireEvent.click(saveButton());

    await waitFor(() => {
      expect(screen.getByText('לכל לייבל חייב להיות שם.')).toBeInTheDocument();
    });
    expect(mutationsSent()).toEqual([]);
    expect(mockSetColumnConfig).not.toHaveBeenCalled();
  });

  it('keeps the grey card at the bottom when the last coloured label is moved down', async () => {
    await renderSettings();
    const lastColoured = screen.getByDisplayValue('נדחה').closest('article');

    // The arrow is disabled — there is nothing below it but the pinned grey card.
    expect(within(lastColoured).getByRole('button', { name: 'הזז למטה' })).toBeDisabled();

    const middle = screen.getByDisplayValue('מאושר אוטומטית').closest('article');
    fireEvent.click(within(middle).getByRole('button', { name: 'הזז למטה' }));

    const order = screen.getAllByRole('article')
      .map((card) => within(card).getByRole('textbox').value);
    expect(order).toEqual(['ממתין', 'נדחה', 'מאושר אוטומטית', '']);
  });
});
