/**
 * The boot overlay must survive the ENTIRE picker boot and no longer.
 *
 * The picker's boot is THREE pieces of work, and only the first is sequential:
 * App resolves the monday context, and then OnClickDialog reads its column
 * settings from storage WHILE it fetches the board's labels and item values —
 * the two run in parallel, because the settings only ever WIDEN the set of
 * columns asked for (people columns named by a people gate), and on a warm open
 * the cached settings already name them before the first await. See
 * MANIFEST.md, "Boot loading state".
 *
 * The overlay has to bridge all of it. A dismissal that fires while either piece
 * is outstanding reopens exactly the gap this feature closes: monday's spinner →
 * a flash of empty dialog → content. These tests pin the handoff, which no unit
 * test of dismissBootLoader() can see.
 *
 * Parallel does NOT mean the paint is unordered: the settings gate the paint even
 * when the board data is already in, because buildAvailableLabels filters by them
 * and the people gate fails closed. Painting on board data alone would show
 * labels the user is not allowed to pick. That is what the second test below
 * pins, and it is the safety property of the parallel fetch.
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
import { GET_STATUS_COLUMN_CONTEXT } from './services/graphqlQueries.js';
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

// The two constants above are frozen, so they can pin a STATE but never a
// TRANSITION — and the settings landing mid-flight is the case the parallel fetch
// introduced. `settingsState` is read on every render, so a test can move the hook
// from loading to ready and re-render. (mockReturnValueOnce cannot do this: it is
// consumed per call, and React's render count is not a stable contract.)
let settingsState = SETTINGS_LOADING;
const setSettingsState = (next) => { settingsState = next; };

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
    setSettingsState(SETTINGS_LOADING);
    mockUseColumnSettings.mockImplementation(() => settingsState);
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

  it('KEEPS holding it when the BOARD DATA has landed but the settings have not', async () => {
    // The board request no longer waits for the settings, so this is now the
    // ORDER a warm open usually resolves in: the network answers before storage.
    // Nothing may paint yet — buildAvailableLabels has not been told what to
    // filter, and the people gate fails closed, so painting here would show
    // labels this user is not allowed to pick. Letting mockQuery stay pending
    // would make this test pass for the wrong reason: the overlay would be held
    // by the outstanding request rather than by the missing settings.
    mockUseMondayContext.mockReturnValue({ context: CONTEXT, loading: false, error: null });
    setSettingsState(SETTINGS_LOADING);
    mockQuery.mockResolvedValue(BOARD_DATA);

    const { container } = await renderApp('/picker');
    await settle();

    expect(overlayIsUp()).toBe(true);
    expect(container.querySelector('.status-menu')).toBeNull();
  });

  it('issues the board request at MOUNT, without waiting for the settings read', async () => {
    // The whole point of the change: storage and the network run together. The
    // columns asked for come from the cache-seeded settings, which are known
    // synchronously on the first render; settings can only ever WIDEN that set.
    mockUseMondayContext.mockReturnValue({ context: CONTEXT, loading: false, error: null });
    setSettingsState(SETTINGS_LOADING);
    mockQuery.mockImplementation(pending);

    await renderApp('/picker');
    await settle();

    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery).toHaveBeenCalledWith(
      GET_STATUS_COLUMN_CONTEXT,
      expect.objectContaining({ columnIds: [PROBE_COLUMN_ID] }),
    );
    expect(overlayIsUp()).toBe(true);
  });

  it('KEEPS holding it while the BOARD DATA is still in flight, settings already in', async () => {
    // The other seam: settings have arrived but the labels/item request has not.
    // Releasing here shows an empty dialog for the length of a monday round-trip.
    // Exact call count and arguments, because "was called at all" stopped
    // discriminating once the request fires unconditionally at mount — it would
    // pass even if the settings were ignored entirely.
    mockUseMondayContext.mockReturnValue({ context: CONTEXT, loading: false, error: null });
    setSettingsState(SETTINGS_READY);
    mockQuery.mockImplementation(pending);

    await renderApp('/picker');
    await settle();

    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery).toHaveBeenCalledWith(
      GET_STATUS_COLUMN_CONTEXT,
      expect.objectContaining({
        boardIds: [String(CONTEXT.boardId)],
        itemIds: [String(CONTEXT.itemId)],
        columnIds: [PROBE_COLUMN_ID],
      }),
    );
    expect(overlayIsUp()).toBe(true);
  });

  it('releases it once the picker has its settings AND its board data', async () => {
    mockUseMondayContext.mockReturnValue({ context: CONTEXT, loading: false, error: null });
    setSettingsState(SETTINGS_READY);
    mockQuery.mockResolvedValue(BOARD_DATA);

    const { container } = await renderApp('/picker');

    await waitFor(() => expect(overlayIsUp()).toBe(false));
    // Released because there is content, not because the load blew up.
    expect(container.querySelector('.status-menu')).not.toBeNull();
  });

  it('releases it when the settings land AFTER the board data, and paints then', async () => {
    // The transition the frozen constants cannot express, and the one the
    // parallel fetch made the common case. The overlay is held across it and
    // comes down once — no release-then-repaint gap.
    mockUseMondayContext.mockReturnValue({ context: CONTEXT, loading: false, error: null });
    setSettingsState(SETTINGS_LOADING);
    mockQuery.mockResolvedValue(BOARD_DATA);

    const { container, rerender } = await renderApp('/picker');
    await settle();
    expect(overlayIsUp()).toBe(true);

    const { default: App } = await import('./App.jsx');
    setSettingsState(SETTINGS_READY);
    rerender(<App />);

    await waitFor(() => expect(overlayIsUp()).toBe(false));
    expect(container.querySelector('.status-menu')).not.toBeNull();
    // The settings landing did not cost a second request: they named no people
    // gate, so the set of columns asked for did not change.
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('releases it on a context error, so the failure is not hidden behind a spinner', async () => {
    mockUseMondayContext.mockReturnValue({ context: null, loading: false, error: 'boom' });

    await renderApp('/picker');

    await waitFor(() => expect(overlayIsUp()).toBe(false));
    expect(screen.getByText(/boom/)).toBeInTheDocument();
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
