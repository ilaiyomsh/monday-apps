/**
 * The webhook enrollment must SURVIVE the save (round329).
 *
 * The bug this suite exists for: enrollment was fired and forgotten
 * (`void enrollColumnGuard(...)`) and the surface was closed in the same tick.
 * enrollColumnGuard cannot POST until `monday.get('sessionToken')` has answered
 * — a postMessage round trip to the parent window — and `closeDialog()` tears
 * the iframe down first, so the request was never sent. Every save reported
 * "ההגדרות נשמרו", no column ever got a webhook, and nothing anywhere said so.
 *
 * Two requirements, both structural:
 *   1. the surface stays open until the enrollment call has settled;
 *   2. an enrollment that did NOT happen is told to the owner — the switch says
 *      the column is protected, so a silent miss is a lie.
 * A guard problem still never fails the save: the settings are already
 * persisted, and the surface closes either way.
 */

import React from 'react';
import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import {
  act, cleanup, fireEvent, render, screen, waitFor,
} from '@testing-library/react';

import statusColumnProbe from '../../test-utils/probes/status-column-context.json';

const mockUseColumnSettings = vi.fn();
const mockQuery = vi.fn();
const mockSetColumnConfig = vi.fn();
const mockShowNotice = vi.fn();
const mockCloseAppFeatureModal = vi.fn();
const mockCloseDialog = vi.fn();
const mockEnroll = vi.fn();

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

// The connection line's own probe is not what this suite is about; keep it inert
// so nothing here depends on a network call.
vi.mock('../../services/guardStatus', () => ({
  getGuardStatus: vi.fn(() => Promise.resolve({
    activated: true, enrolled: false, primaryAuthorized: true, meAuthorized: true,
  })),
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

const footerSave = () => screen.getByRole('button', { name: 'שמור' });

async function openSettings() {
  render(<ColumnSettings context={CONTEXT} />);
  await waitFor(() => expect(footerSave()).toBeEnabled());
}

/** Let every already-queued microtask AND macrotask run — the fire-and-forget
 *  path closed the surface one microtask after the enroll call, so a flush is
 *  what makes "did not close yet" a real assertion rather than a lucky order. */
const flush = () => act(async () => {
  await new Promise((resolve) => { setTimeout(resolve, 0); });
});

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
  installQueryRoutes();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('the guard enrollment outlives the save that triggers it', () => {
  it('keeps the settings surface open until the enrollment call has settled', async () => {
    let releaseEnroll;
    mockEnroll.mockImplementation(() => new Promise((resolve) => { releaseEnroll = resolve; }));

    await openSettings();
    fireEvent.click(footerSave());

    await waitFor(() => expect(mockEnroll).toHaveBeenCalledTimes(1));
    await flush();

    // THE regression: closing here kills the in-flight POST (the iframe goes away).
    expect(mockCloseAppFeatureModal).not.toHaveBeenCalled();
    expect(mockCloseDialog).not.toHaveBeenCalled();

    releaseEnroll('enrolled');
    await waitFor(() => expect(mockCloseAppFeatureModal).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockCloseDialog).toHaveBeenCalledTimes(1));
  });

  it('enrolls the board+column that were just saved', async () => {
    await openSettings();
    fireEvent.click(footerSave());

    await waitFor(() => expect(mockSetColumnConfig).toHaveBeenCalledTimes(1));
    expect(mockEnroll).toHaveBeenCalledWith({ boardId: BOARD_ID, columnId: STATUS_COLUMN_ID });
  });

  it('tells the owner when the guard is not connected, so "protected" is never a lie', async () => {
    mockEnroll.mockResolvedValue('not_activated');

    await openSettings();
    fireEvent.click(footerSave());
    await waitFor(() => expect(mockCloseDialog).toHaveBeenCalledTimes(1));

    const warning = mockShowNotice.mock.calls.find(([, type]) => type === 'error');
    expect(warning, 'an unenrolled column must not close silently').toBeTruthy();
    expect(warning[0]).toMatch(/חיבור|מחובר/);
  });

  it('tells the owner when enrollment itself failed', async () => {
    mockEnroll.mockResolvedValue('failed');

    await openSettings();
    fireEvent.click(footerSave());
    await waitFor(() => expect(mockCloseDialog).toHaveBeenCalledTimes(1));

    const warning = mockShowNotice.mock.calls.find(([, type]) => type === 'error');
    expect(warning, 'a failed enrollment must not close silently').toBeTruthy();
    expect(warning[0]).toMatch(/נכשל/);
  });

  it('reports the save as successful and closes even when the guard is unreachable', async () => {
    mockEnroll.mockResolvedValue('failed');

    await openSettings();
    fireEvent.click(footerSave());
    await waitFor(() => expect(mockCloseDialog).toHaveBeenCalledTimes(1));

    // The settings ARE persisted — a guard problem never rewrites that outcome.
    expect(mockSetColumnConfig).toHaveBeenCalledTimes(1);
    expect(mockShowNotice).toHaveBeenCalledWith('ההגדרות נשמרו');
    expect(screen.queryByText(/שמירת ההגדרות נכשלה/)).not.toBeInTheDocument();
  });

  it('says nothing extra when the dev harness has no guard at all', async () => {
    mockEnroll.mockResolvedValue('disabled');

    await openSettings();
    fireEvent.click(footerSave());
    await waitFor(() => expect(mockCloseDialog).toHaveBeenCalledTimes(1));

    expect(mockShowNotice.mock.calls.filter(([, type]) => type === 'error')).toEqual([]);
  });
});
