/**
 * A label is CREATED on the click, not on save (owner request, after a live report).
 *
 * The old flow appended a local row with a colour it picked itself and deferred the
 * mutation to save. Both halves of that were wrong, because monday — not the client —
 * decides what a new label looks like: the colour's numeric id BECOMES the label id, and
 * the platform can override the colour server-side. The visible result was a label that
 * changed appearance twice: purple in settings, grey on the board, orange on re-entry
 * (grey is monday's override for the reserved id-5 slot; orange is `explosive` re-derived
 * from the stored colour index).
 *
 * So the round trip happens on the click, behind a busy button, and the card is rendered
 * from what came back. This suite pins that: the colour shown is monday's, the mutation
 * carries a colour whose id is actually free, and a failure adds nothing.
 *
 * The board shape and label ids come from the recorded probe.
 */

import React from 'react';
import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import {
  cleanup, fireEvent, render, screen, waitFor,
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
const LIVE_LABELS = STATUS_COLUMN.settings.labels;
const TEXT_COLUMN = {
  id: 'text_1', title: 'הערה', type: 'text', settings: {},
};

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
 * @param created what the refresh reports as the new label — the point being that the
 *   card must reflect THIS, not whatever the client picked before the call.
 */
function installQueryRoutes({ created, failMutation = false, onMutation } = {}) {
  let mutated = false;
  mockQuery.mockImplementation((query, variables) => {
    if (query.includes('GetBoardSettingsMetadata')) {
      return Promise.resolve({
        boards: [{ id: BOARD_ID, columns: [STATUS_COLUMN, TEXT_COLUMN] }],
        users: [],
      });
    }
    if (query.includes('update_status_column')) {
      if (onMutation) onMutation(query, variables);
      if (failMutation) {
        return Promise.reject(new Error('request to change default status label color'));
      }
      mutated = true;
      return Promise.resolve({ update_status_column: { id: STATUS_COLUMN_ID } });
    }
    if (query.includes('GetStatusColumnRevision')) {
      return Promise.resolve(revisionResponse(
        mutated && created ? [...LIVE_LABELS, created] : LIVE_LABELS,
      ));
    }
    return Promise.resolve({});
  });
}

/**
 * Vibe's Button reports state through ARIA rather than the native attributes, so
 * busy/idle is read off aria-busy / aria-disabled — `toBeDisabled()` would pass on a
 * button that is very much disabled.
 */
const addButton = () => screen.getAllByTestId('button')
  .find((button) => button.getAttribute('data-vibe') === 'Button'
    && button.closest('.twyst-settings-toolbar'));
const isBusy = () => addButton().getAttribute('aria-busy') === 'true';

async function renderSettings() {
  render(<ColumnSettings context={CONTEXT} />);
  await waitFor(() => expect(addButton()).toHaveAttribute('aria-disabled', 'false'));
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

describe('creating a label on the click', () => {
  it('fires update_status_column immediately, before any save', async () => {
    installQueryRoutes({
      created: {
        id: 3, color: 3, label: 'לייבל חדש', index: 3, is_done: false, is_deactivated: false, hex: '#007eb5',
      },
    });
    await renderSettings();

    expect(mockQuery.mock.calls.some(([q]) => q.includes('update_status_column'))).toBe(false);
    fireEvent.click(addButton());

    await waitFor(() => {
      expect(mockQuery.mock.calls.some(([q]) => q.includes('update_status_column'))).toBe(true);
    });
    // The settings blob is only written by Save — creating a label must not touch it.
    expect(mockSetColumnConfig).not.toHaveBeenCalled();
  });

  it('shows the button busy while the call is in flight and no card until it returns', async () => {
    let releaseMutation;
    const gate = new Promise((resolve) => { releaseMutation = resolve; });
    installQueryRoutes({
      created: {
        id: 3, color: 3, label: 'לייבל חדש', index: 3, is_done: false, is_deactivated: false, hex: '#007eb5',
      },
    });
    const passthrough = mockQuery.getMockImplementation();
    mockQuery.mockImplementation(async (query, variables) => {
      if (query.includes('update_status_column')) await gate;
      return passthrough(query, variables);
    });

    await renderSettings();
    fireEvent.click(addButton());

    await waitFor(() => expect(isBusy()).toBe(true));
    expect(addButton()).toHaveAttribute('aria-disabled', 'true');
    expect(screen.queryByDisplayValue('לייבל חדש')).toBeNull();

    releaseMutation();
    await waitFor(() => expect(screen.getByDisplayValue('לייבל חדש')).toBeInTheDocument());
    // The card can render a tick before the flag clears; both must settle.
    await waitFor(() => expect(isBusy()).toBe(false));
    expect(addButton()).toHaveAttribute('aria-disabled', 'false');
  });

  it("renders monday's colour, not the one the client asked for", async () => {
    // Sent dark_blue(3); monday reports the label back as grey — the board's truth.
    installQueryRoutes({
      created: {
        id: 3, color: 3, label: 'לייבל חדש', index: 3, is_done: false, is_deactivated: false, hex: '#c4c4c4',
      },
    });
    await renderSettings();
    fireEvent.click(addButton());

    const card = await waitFor(() => screen.getByDisplayValue('לייבל חדש').closest('article'));
    const swatch = card.querySelector('.twyst-color-circle');
    expect(swatch).toHaveStyle({ background: '#c4c4c4' });
    expect(swatch).not.toHaveStyle({ background: '#007eb5' });

    /*
     * And the other cards still show their OWN colours. Without this, a swatch that
     * simply rendered grey for everything would satisfy the assertion above — the
     * grey here has to be monday's answer for THIS label, not a constant.
     */
    const existing = screen.getByDisplayValue('ממתין').closest('article');
    expect(existing.querySelector('.twyst-color-circle')).toHaveStyle({ background: '#fdab3d' });
  });

  it('asks for a colour whose id is free, skipping the reserved empty-label slot', async () => {
    let sentMutation = '';
    installQueryRoutes({
      created: {
        id: 3, color: 3, label: 'לייבל חדש', index: 3, is_done: false, is_deactivated: false, hex: '#007eb5',
      },
      onMutation: (query) => { sentMutation = query; },
    });
    await renderSettings();
    fireEvent.click(addButton());
    await waitFor(() => expect(sentMutation).toContain('update_status_column'));

    // Probe column holds ids 0,1,2 -> the only safe choice is dark_blue(3).
    expect(sentMutation).toMatch(/color: dark_blue[^}]*}\s*\]/);
    expect(sentMutation).not.toMatch(/color: explosive/);
  });

  it('resends every existing label, because an omitted label is a DELETE', async () => {
    let sentMutation = '';
    installQueryRoutes({
      created: {
        id: 3, color: 3, label: 'לייבל חדש', index: 3, is_done: false, is_deactivated: false, hex: '#007eb5',
      },
      onMutation: (query) => { sentMutation = query; },
    });
    await renderSettings();
    fireEvent.click(addButton());
    await waitFor(() => expect(sentMutation).toContain('update_status_column'));

    expect(sentMutation).toContain('id: 0');
    expect(sentMutation).toContain('id: 1');
    expect(sentMutation).toContain('id: 2');
    // ...and the "Done" flag on label 1 survives the round trip.
    expect(sentMutation).toMatch(/id: 1[^}]*is_done: true/);
  });

  it('surfaces a failure and adds no card', async () => {
    installQueryRoutes({ failMutation: true });
    await renderSettings();
    fireEvent.click(addButton());

    await waitFor(() => {
      expect(screen.getByText(/לא נותר צבע פנוי/)).toBeInTheDocument();
    });
    expect(screen.queryByDisplayValue('לייבל חדש')).toBeNull();
    expect(screen.getByRole('button', { name: 'הוספת לייבל' })).toBeEnabled();
  });

  it('reports a failure when the refresh does not show the created label', async () => {
    installQueryRoutes({ created: null });
    await renderSettings();
    fireEvent.click(addButton());

    await waitFor(() => {
      expect(screen.getByText(/הוספת הלייבל נכשלה/)).toBeInTheDocument();
    });
    expect(screen.queryByDisplayValue('לייבל חדש')).toBeNull();
  });

  it('keeps an unsaved rename on another card while the new label is added', async () => {
    installQueryRoutes({
      created: {
        id: 3, color: 3, label: 'לייבל חדש', index: 3, is_done: false, is_deactivated: false, hex: '#007eb5',
      },
    });
    await renderSettings();

    fireEvent.change(screen.getByDisplayValue('ממתין'), { target: { value: 'בהמתנה' } });
    fireEvent.click(addButton());

    await waitFor(() => expect(screen.getByDisplayValue('לייבל חדש')).toBeInTheDocument());
    expect(screen.getByDisplayValue('בהמתנה')).toBeInTheDocument();
  });

  it('does not resend the freshly created label as an edit when nothing else changed', async () => {
    installQueryRoutes({
      created: {
        id: 3, color: 3, label: 'לייבל חדש', index: 3, is_done: false, is_deactivated: false, hex: '#007eb5',
      },
    });
    await renderSettings();
    fireEvent.click(addButton());
    await waitFor(() => expect(screen.getByDisplayValue('לייבל חדש')).toBeInTheDocument());

    const mutationsAfterCreate = mockQuery.mock.calls
      .filter(([q]) => q.includes('update_status_column')).length;
    fireEvent.click(screen.getByRole('button', { name: 'שמור' }));
    await waitFor(() => expect(mockSetColumnConfig).toHaveBeenCalled());

    expect(mockQuery.mock.calls.filter(([q]) => q.includes('update_status_column')).length)
      .toBe(mutationsAfterCreate);
  });
});
