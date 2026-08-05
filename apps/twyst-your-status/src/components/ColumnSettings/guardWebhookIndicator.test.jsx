/**
 * "Is this column actually registered with the guard?" — answered on screen,
 * and fixable from there (round330, owner request).
 *
 * Until now the only way to know whether a column carried its webhook was to
 * query monday's API or read the server log; the settings screen showed the
 * OAuth connection and nothing about the registration itself. `/api/guard/status`
 * already reports `enrolled` per column — the client simply dropped it.
 *
 * Two surfaces, both pinned here:
 *   - a state line: registered / not registered / unknown (the guard did not
 *     answer). Unknown must NOT read as "not registered" — that would send an
 *     owner chasing a problem that may not exist;
 *   - a manual register button, so an owner can create the webhook without
 *     re-saving the whole settings form, and see the line flip when it lands.
 *     It is shown only when the column is NOT already registered, so clicking
 *     it can never add a second webhook to the same column.
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
const mockCloseAppFeatureModal = vi.fn();
const mockCloseDialog = vi.fn();
const mockEnroll = vi.fn();
const mockGuardStatus = vi.fn();

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

vi.mock('../../services/guardEnroll', () => ({
  enrollColumnGuard: (...args) => mockEnroll(...args),
}));

vi.mock('../../services/guardStatus', () => ({
  getGuardStatus: (...args) => mockGuardStatus(...args),
}));

vi.mock('../../services/guardAuthorize', () => ({
  startGuardAuthorization: vi.fn(() => Promise.resolve('opened')),
}));

const { default: ColumnSettings } = await import('./ColumnSettings.jsx');

const BOARD_ID = statusColumnProbe.query.boards[0].id;
const STATUS_COLUMN = statusColumnProbe.query.boards[0].columns[0];
const STATUS_COLUMN_ID = STATUS_COLUMN.id;

const CONTEXT = {
  boardId: BOARD_ID,
  columnId: STATUS_COLUMN_ID,
  user: { id: '3', currentLanguage: 'he' },
  theme: 'light',
};

const guardStatus = (over = {}) => ({
  activated: true, enrolled: true, primaryAuthorized: true, meAuthorized: true, ...over,
});

function installQueryRoutes() {
  mockQuery.mockImplementation((query) => {
    if (query.includes('GetBoardSettingsMetadata')) {
      return Promise.resolve({ boards: [{ id: BOARD_ID, columns: [STATUS_COLUMN] }], users: [] });
    }
    if (query.includes('AccountUsers')) return Promise.resolve({ users: [] });
    if (query.includes('GetStatusColumnRevision')) {
      return Promise.resolve({
        boards: [{
          id: BOARD_ID,
          columns: [{
            id: STATUS_COLUMN_ID,
            type: 'status',
            revision: 'rev-1',
            settings: STATUS_COLUMN.settings,
          }],
        }],
      });
    }
    return Promise.resolve({});
  });
}

const hookLine = () => document.querySelector('.twyst-guard-hook');
const registerButton = () => screen.queryByRole('button', { name: /רישום השומר על העמודה/ });

async function openSettings() {
  render(<ColumnSettings context={CONTEXT} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'שמור' })).toBeEnabled());
  await waitFor(() => expect(hookLine()).toBeTruthy());
}

beforeEach(() => {
  mockUseColumnSettings.mockImplementation(() => ({
    settings: null, loading: false, error: null, reload: vi.fn(),
  }));
  mockQuery.mockReset();
  mockSetColumnConfig.mockReset().mockResolvedValue(undefined);
  mockShowNotice.mockReset();
  mockCloseAppFeatureModal.mockReset().mockResolvedValue(undefined);
  mockCloseDialog.mockReset().mockResolvedValue(undefined);
  mockEnroll.mockReset().mockResolvedValue('enrolled');
  mockGuardStatus.mockReset().mockResolvedValue(guardStatus());
  installQueryRoutes();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('the settings screen reports whether the column carries its webhook', () => {
  it('confirms an enrolled column, and offers no register button — a second webhook would double every event', async () => {
    mockGuardStatus.mockResolvedValue(guardStatus({ enrolled: true }));

    await openSettings();

    expect(hookLine()).toHaveTextContent(/רשומה/);
    expect(hookLine().className).toMatch(/twyst-guard-hook--ok/);
    expect(registerButton()).toBeNull();
  });

  it('says an unenrolled column is unwatched, and offers the register button', async () => {
    mockGuardStatus.mockResolvedValue(guardStatus({ enrolled: false }));

    await openSettings();

    expect(hookLine()).toHaveTextContent(/אינה רשומה/);
    expect(hookLine().className).toMatch(/twyst-guard-hook--need/);
    expect(registerButton()).toBeTruthy();
  });

  it('does not claim "not registered" when the guard never answered', async () => {
    mockGuardStatus.mockResolvedValue(guardStatus({ enrolled: null }));

    await openSettings();

    // The distinction that matters: unknown is unknown. Reading it as "false"
    // would send an owner hunting a webhook that may be there.
    expect(hookLine()).not.toHaveTextContent(/אינה רשומה/);
    expect(hookLine()).toHaveTextContent(/לא ידוע/);
    expect(hookLine().className).toMatch(/twyst-guard-hook--unknown/);
    // Still actionable — registering is idempotent server-side.
    expect(registerButton()).toBeTruthy();
  });
});

describe('the manual register button', () => {
  it('enrolls this board+column and re-reads the state, so the line flips on success', async () => {
    mockGuardStatus.mockResolvedValueOnce(guardStatus({ enrolled: false }));
    await openSettings();

    // The webhook exists from here on: the re-read after the click must be what
    // the line reflects, not the stale value it rendered with.
    mockGuardStatus.mockResolvedValue(guardStatus({ enrolled: true }));
    fireEvent.click(registerButton());

    await waitFor(() => expect(hookLine()).toHaveTextContent(/רשומה/));
    expect(mockEnroll).toHaveBeenCalledWith({ boardId: BOARD_ID, columnId: STATUS_COLUMN_ID });
    expect(registerButton()).toBeNull();
  });

  it('registers WITHOUT saving the settings form — it is a repair, not a save', async () => {
    mockGuardStatus.mockResolvedValue(guardStatus({ enrolled: false }));
    await openSettings();

    fireEvent.click(registerButton());
    await waitFor(() => expect(mockEnroll).toHaveBeenCalledTimes(1));

    expect(mockSetColumnConfig).not.toHaveBeenCalled();
    expect(mockCloseDialog).not.toHaveBeenCalled();
  });

  it('names the reason when the account has not authorized the guard', async () => {
    mockGuardStatus.mockResolvedValue(guardStatus({ enrolled: false }));
    mockEnroll.mockResolvedValue('not_activated');
    await openSettings();

    fireEvent.click(registerButton());
    await waitFor(() => expect(mockShowNotice).toHaveBeenCalled());

    const [text, type] = mockShowNotice.mock.calls.at(-1);
    expect(type).toBe('error');
    expect(text).toMatch(/חיבור|מחובר/);
  });

  it('names the reason when the user is not a board owner — retrying cannot fix a permission', async () => {
    mockGuardStatus.mockResolvedValue(guardStatus({ enrolled: false }));
    mockEnroll.mockResolvedValue('not_board_owner');
    await openSettings();

    fireEvent.click(registerButton());
    await waitFor(() => expect(mockShowNotice).toHaveBeenCalled());

    const [text, type] = mockShowNotice.mock.calls.at(-1);
    expect(type).toBe('error');
    expect(text).toMatch(/בעלי הלוח/);
  });

  it('reports success so a click is never silent', async () => {
    mockGuardStatus.mockResolvedValue(guardStatus({ enrolled: false }));
    await openSettings();

    fireEvent.click(registerButton());
    await waitFor(() => expect(mockShowNotice).toHaveBeenCalled());

    const [text, type] = mockShowNotice.mock.calls.at(-1);
    expect(type).toBeUndefined();
    expect(text).toMatch(/נרשמה|נרשם/);
  });

  it('cannot be double-clicked into two webhooks while the first call is in flight', async () => {
    mockGuardStatus.mockResolvedValue(guardStatus({ enrolled: false }));
    let release;
    mockEnroll.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    await openSettings();

    fireEvent.click(registerButton());
    await waitFor(() => expect(registerButton()).toBeDisabled());
    fireEvent.click(registerButton());

    expect(mockEnroll).toHaveBeenCalledTimes(1);
    release('enrolled');
    await waitFor(() => expect(mockShowNotice).toHaveBeenCalled());
  });
});
