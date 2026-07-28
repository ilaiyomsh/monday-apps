/**
 * The boot overlay must survive the ENTIRE picker boot and no longer.
 *
 * The picker loads in THREE phases — App resolves the monday context, then
 * OnClickDialog loads its column settings, then it fetches the board's labels and
 * item values — and the overlay has to bridge all of them. A dismissal that fires
 * between any two reopens exactly the gap this feature closes: monday's spinner →
 * a flash of empty dialog → content. These tests pin the handoff, which no unit
 * test of dismissBootLoader() can see.
 *
 * The board-data phase is driven by the RECORDED probe response
 * (src/test-utils/probes/status-column-context.json) rather than a hand-written
 * shape — an earlier version of this file mocked a method OnClickDialog does not
 * call, so the request threw, the catch ran, and the phase silently never
 * happened while the test still went green.
 */

import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { BOOT_LOADER_ID } from './utils/bootLoader.js';
import statusColumnProbe from './test-utils/probes/status-column-context.json';

const mockUseMondayContext = vi.fn();
const mockUseColumnSettings = vi.fn();
const mockQuery = vi.fn();

vi.mock('./hooks/useMondayContext', () => ({
  useMondayContext: (...args) => mockUseMondayContext(...args),
}));

vi.mock('./hooks/useColumnSettings', () => ({
  default: (...args) => mockUseColumnSettings(...args),
}));

vi.mock('./services/mondayService', () => ({
  default: {
    query: (...args) => mockQuery(...args),
    closeDialog: vi.fn(),
    showNotice: vi.fn(),
  },
}));

vi.mock('./services/teamsAccess', () => ({
  loadUserTeamIds: vi.fn(() => Promise.resolve({ teamIds: [] })),
}));

/** The probe's board/item payload, exactly as the monday API returned it. */
const BOARD_DATA = {
  boards: statusColumnProbe.query.boards,
  items: statusColumnProbe.query.items,
};
const PROBE_COLUMN_ID = statusColumnProbe.query.boards[0].columns[0].id;

const CONTEXT = {
  boardId: statusColumnProbe.query.boards[0].id,
  columnId: PROBE_COLUMN_ID,
  itemId: statusColumnProbe.query.items[0].id,
  user: { id: '3', currentLanguage: 'he' },
  theme: 'light',
};

const SETTINGS_LOADING = { settings: null, loading: true, error: null, reload: vi.fn() };
const SETTINGS_READY = {
  settings: { version: 1, hiddenLabelIds: [], labels: {} },
  loading: false,
  error: null,
  reload: vi.fn(),
};

/** A request that never settles — holds whichever phase is under test. */
const pending = () => new Promise(() => {});

function mountOverlay() {
  const overlay = document.createElement('div');
  overlay.id = BOOT_LOADER_ID;
  document.body.appendChild(overlay);
}

const overlayIsUp = () => document.getElementById(BOOT_LOADER_ID) !== null;

/** Let every already-resolved promise and its effects flush. */
const settle = () => new Promise((resolve) => { setTimeout(resolve, 0); });

async function renderApp(pathname) {
  window.history.replaceState({}, '', pathname);
  const { default: App } = await import('./App.jsx');
  return render(<App />);
}

describe('boot overlay handoff', () => {
  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = '';
    mountOverlay();
    mockUseColumnSettings.mockReturnValue(SETTINGS_LOADING);
    mockQuery.mockImplementation(pending);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('holds the overlay while the monday context is still loading', async () => {
    mockUseMondayContext.mockReturnValue({ context: null, loading: true, error: null });

    await renderApp('/picker');

    expect(overlayIsUp()).toBe(true);
  });

  it('KEEPS holding it after the context resolves, while the settings load', async () => {
    // The regression this guards: App stops loading, so a naive "dismiss when
    // App is done" would fire here — while OnClickDialog still has nothing.
    mockUseMondayContext.mockReturnValue({ context: CONTEXT, loading: false, error: null });
    mockUseColumnSettings.mockReturnValue(SETTINGS_LOADING);

    await renderApp('/picker');
    await settle();

    expect(overlayIsUp()).toBe(true);
  });

  it('KEEPS holding it while the BOARD DATA is still in flight, settings already in', async () => {
    // The second seam: settings have arrived but the labels/item request has not.
    // Releasing here shows an empty dialog for the length of a monday round-trip.
    mockUseMondayContext.mockReturnValue({ context: CONTEXT, loading: false, error: null });
    mockUseColumnSettings.mockReturnValue(SETTINGS_READY);
    mockQuery.mockImplementation(pending);

    await renderApp('/picker');
    await settle();

    expect(mockQuery).toHaveBeenCalled();
    expect(overlayIsUp()).toBe(true);
  });

  it('releases it once the picker has its settings AND its board data', async () => {
    mockUseMondayContext.mockReturnValue({ context: CONTEXT, loading: false, error: null });
    mockUseColumnSettings.mockReturnValue(SETTINGS_READY);
    mockQuery.mockResolvedValue(BOARD_DATA);

    const { container } = await renderApp('/picker');

    await waitFor(() => expect(overlayIsUp()).toBe(false));
    // Released because there is content, not because the load blew up.
    expect(container.querySelector('.status-menu')).not.toBeNull();
  });

  it('releases it on a context error, so the failure is not hidden behind a spinner', async () => {
    mockUseMondayContext.mockReturnValue({ context: null, loading: false, error: 'boom' });

    await renderApp('/picker');

    await waitFor(() => expect(overlayIsUp()).toBe(false));
    // getByText throws when the node is absent, so this is the assertion.
    // (jest-dom's toBeInTheDocument is unavailable here — its matchers never
    // register in this app, a pre-existing pnpm dual-vitest-instance gap.)
    expect(screen.getByText(/boom/)).toBeTruthy();
  });

  it('releases it immediately on non-picker routes — it is the picker\'s continuation only', async () => {
    mockUseMondayContext.mockReturnValue({ context: CONTEXT, loading: true, error: null });

    await renderApp('/settings');

    await waitFor(() => expect(overlayIsUp()).toBe(false));
  });

  it('shows no loader of its own under the overlay — that second loader was the jump', async () => {
    mockUseMondayContext.mockReturnValue({ context: null, loading: true, error: null });

    const { container } = await renderApp('/picker');

    expect(container.querySelector('.status-option-skeleton')).toBeNull();
    expect(container.textContent).not.toMatch(/טוען|Loading/);
  });
});
