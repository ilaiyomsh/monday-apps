/**
 * SettingsContext — loading the per-instance blob, merging partial writes, and the
 * gate that blocks render until the blob is known.
 *
 * Why each behaviour below is worth a test rather than a glance:
 *
 *  - **The gate is a safety mechanism, not a UX nicety.** Every API call in this app
 *    needs `settings.boardId` and the five column ids. If children render before the
 *    blob has loaded, a query fires with empty ids — which monday answers with an
 *    empty list rather than an error, so the bug looks like "the board has no items".
 *  - **The storage key can change after the first load.** `MondayProvider` installs
 *    `{}` after a 4s watchdog, which resolves to the `_default` key; a real
 *    `instanceId` arriving later must trigger a RELOAD. A boolean "already loaded"
 *    latch is exactly the bug that leaves a configured instance stuck on empty
 *    default settings (shipped once in Axis Planner).
 *  - **A partial write must not wipe its siblings.** The panel saves one section at a
 *    time, so `{columns: {action: 'x'}}` has to keep the other four roles — while
 *    `blocks` must REPLACE wholesale, or a deleted block resurrects itself.
 *  - **An unpersisted save must not look persisted.** `settingsStore.saveSettings`
 *    throws when it cannot confirm the write; the optimistic in-memory value has to
 *    roll back, or the owner sees a mapping that only exists in their tab.
 *
 * `utils/settingsStore` is mocked with importOriginal so `settingsKeyCandidates`
 * stays REAL — the key resolution is the thing the reload test depends on, and
 * stubbing it would make that test pass against a fiction.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, cleanup } from '@testing-library/react';
import { loadSettings, saveSettings } from '../../utils/settingsStore';
import { useMonday } from '../MondayContext';
import { useIsOwner } from '../../hooks/useIsOwner';
import { DEFAULT_SETTINGS } from '../../domain/settingsSchema';
import {
  SettingsProvider,
  SettingsGate,
  useSettings,
  mergeSettingsPatch,
} from '../SettingsContext';

vi.mock('../../utils/settingsStore', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    loadSettings: vi.fn(),
    saveSettings: vi.fn(),
  };
});
vi.mock('../MondayContext', () => ({ useMonday: vi.fn() }));
vi.mock('../../hooks/useIsOwner', () => ({ useIsOwner: vi.fn() }));
vi.mock('../../utils/logger', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../components/SettingsPanel', () => ({
  SettingsPanel: ({ forced }) => (
    <div data-testid="settings-panel">{forced ? 'forced' : 'optional'}</div>
  ),
}));

/** A fully-configured stored blob — the "app can run" state. */
const CONFIGURED = {
  version: 1,
  boardId: '18424252636',
  columns: {
    action: 'text_action',
    committee: 'mirror_committee',
    report: 'long_text_report',
    date: 'date_report',
    person: 'people_owner',
  },
  headers: { action: '', committee: '', report: '', date: '' },
  mergeAction: true,
  mergeCommittee: true,
  weekStartsOn: 0,
  blocks: [
    { id: 'block-1', type: 'text', text: 'פתיח' },
    { id: 'table', type: 'table' },
  ],
};

const setContext = (context) =>
  useMonday.mockReturnValue({ context, currentUser: context?.user ?? null, isMobile: false });

/** Publishes the live context value so a test can assert on it. */
let seen;
function Probe() {
  seen = useSettings();
  return <div data-testid="probe">{seen.isLoading ? 'loading' : 'ready'}</div>;
}

const renderProvider = () =>
  render(
    <SettingsProvider>
      <Probe />
    </SettingsProvider>
  );

beforeEach(() => {
  vi.clearAllMocks();
  seen = undefined;
  loadSettings.mockResolvedValue(null);
  saveSettings.mockImplementation(async (_context, partial) => partial);
  useIsOwner.mockReturnValue({ isOwner: true, isLoading: false });
});

afterEach(() => {
  cleanup();
});

describe('mergeSettingsPatch', () => {
  it('merges the columns map key-by-key so a one-role write keeps the other four', () => {
    const next = mergeSettingsPatch(CONFIGURED, { columns: { action: 'status_action' } });

    expect(next.columns).toEqual({
      action: 'status_action',
      committee: 'mirror_committee',
      report: 'long_text_report',
      date: 'date_report',
      person: 'people_owner',
    });
  });

  it('replaces the blocks array wholesale, so a deleted block cannot resurrect', () => {
    const next = mergeSettingsPatch(CONFIGURED, { blocks: [{ id: 'table', type: 'table' }] });

    expect(next.blocks).toEqual([{ id: 'table', type: 'table' }]);
  });

  it('replaces scalars and keeps every untouched key', () => {
    const next = mergeSettingsPatch(CONFIGURED, { boardId: '999', mergeCommittee: false });

    expect(next.boardId).toBe('999');
    expect(next.mergeCommittee).toBe(false);
    expect(next.mergeAction).toBe(true);
    expect(next.weekStartsOn).toBe(0);
    expect(next.blocks).toEqual(CONFIGURED.blocks);
  });

  it('ignores an undefined value rather than blanking the stored key', () => {
    const next = mergeSettingsPatch(CONFIGURED, { boardId: undefined, mergeAction: false });

    expect(next.boardId).toBe('18424252636');
    expect(next.mergeAction).toBe(false);
  });

  it('returns the base untouched for a patch that is not a plain object', () => {
    expect(mergeSettingsPatch(CONFIGURED, null)).toEqual(CONFIGURED);
    expect(mergeSettingsPatch(CONFIGURED, ['columns'])).toEqual(CONFIGURED);
  });

  it('never mutates the base blob', () => {
    const base = JSON.parse(JSON.stringify(CONFIGURED));
    mergeSettingsPatch(base, { columns: { action: 'other' }, blocks: [] });

    expect(base).toEqual(CONFIGURED);
  });
});

describe('loading the blob', () => {
  it('asks nobody and stays loading while the monday context is still null', () => {
    setContext(null);
    renderProvider();

    expect(loadSettings).not.toHaveBeenCalled();
    expect(seen.isLoading).toBe(true);
    expect(screen.getByTestId('probe')).toHaveTextContent('loading');
  });

  it('loads under the instance key and exposes the normalized blob', async () => {
    setContext({ instanceId: 55555555, boardId: 1234567890 });
    loadSettings.mockResolvedValue(CONFIGURED);

    renderProvider();
    await waitFor(() => expect(seen.isLoading).toBe(false));

    expect(loadSettings).toHaveBeenCalledTimes(1);
    expect(loadSettings).toHaveBeenCalledWith({ instanceId: 55555555, boardId: 1234567890 });
    expect(seen.settings.boardId).toBe('18424252636');
    expect(seen.settings.columns.committee).toBe('mirror_committee');
    expect(seen.isConfigured).toBe(true);
  });

  it('falls back to defaults, unconfigured, when nothing is stored', async () => {
    setContext({ instanceId: 55555555 });
    loadSettings.mockResolvedValue(null);

    renderProvider();
    await waitFor(() => expect(seen.isLoading).toBe(false));

    expect(seen.settings).toEqual(DEFAULT_SETTINGS);
    expect(seen.isConfigured).toBe(false);
  });

  it('reports unconfigured for a blob missing a single column role', async () => {
    setContext({ instanceId: 55555555 });
    loadSettings.mockResolvedValue({
      ...CONFIGURED,
      columns: { ...CONFIGURED.columns, person: '' },
    });

    renderProvider();
    await waitFor(() => expect(seen.isLoading).toBe(false));

    expect(seen.isConfigured).toBe(false);
    // The rest of the mapping still survives, so the panel can show what is missing.
    expect(seen.settings.columns.action).toBe('text_action');
  });

  it('reloads when a real instanceId lands after the watchdog loaded the default key', async () => {
    setContext({});
    loadSettings.mockResolvedValue(null);

    const { rerender } = renderProvider();
    await waitFor(() => expect(loadSettings).toHaveBeenCalledTimes(1));
    expect(loadSettings).toHaveBeenCalledWith({});

    loadSettings.mockResolvedValue(CONFIGURED);
    setContext({ instanceId: 55555555, boardId: 1234567890 });
    rerender(
      <SettingsProvider>
        <Probe />
      </SettingsProvider>
    );

    await waitFor(() => expect(seen.isConfigured).toBe(true));
    expect(loadSettings).toHaveBeenCalledTimes(2);
  });

  it('does not reload when the context re-emits with the same instance', async () => {
    setContext({ instanceId: 55555555, theme: 'light' });
    loadSettings.mockResolvedValue(CONFIGURED);

    const { rerender } = renderProvider();
    await waitFor(() => expect(seen.isLoading).toBe(false));

    // A fresh object with the same identity fields — monday re-emits constantly.
    setContext({ instanceId: 55555555, theme: 'dark' });
    rerender(
      <SettingsProvider>
        <Probe />
      </SettingsProvider>
    );
    await waitFor(() => expect(seen.isConfigured).toBe(true));

    expect(loadSettings).toHaveBeenCalledTimes(1);
  });
});

describe('updateSettings', () => {
  it('hands settingsStore the PARTIAL, and exposes the merged result', async () => {
    setContext({ instanceId: 55555555 });
    loadSettings.mockResolvedValue(CONFIGURED);

    renderProvider();
    await waitFor(() => expect(seen.isLoading).toBe(false));

    await act(async () => {
      await seen.updateSettings({ columns: { action: 'status_action' } });
    });

    expect(saveSettings).toHaveBeenCalledTimes(1);
    expect(saveSettings).toHaveBeenCalledWith(
      { instanceId: 55555555 },
      { columns: { action: 'status_action' } }
    );
    expect(seen.settings.columns.action).toBe('status_action');
    expect(seen.settings.columns.committee).toBe('mirror_committee');
  });

  it('returns the merged blob to the caller', async () => {
    setContext({ instanceId: 55555555 });
    loadSettings.mockResolvedValue(CONFIGURED);

    renderProvider();
    await waitFor(() => expect(seen.isLoading).toBe(false));

    let returned;
    await act(async () => {
      returned = await seen.updateSettings({ boardId: '777' });
    });

    expect(returned.boardId).toBe('777');
    expect(returned.columns.date).toBe('date_report');
  });

  it('flips isConfigured once the last missing role is filled in', async () => {
    setContext({ instanceId: 55555555 });
    loadSettings.mockResolvedValue({
      ...CONFIGURED,
      columns: { ...CONFIGURED.columns, person: '' },
    });

    renderProvider();
    await waitFor(() => expect(seen.isLoading).toBe(false));
    expect(seen.isConfigured).toBe(false);

    await act(async () => {
      await seen.updateSettings({ columns: { person: 'people_owner' } });
    });

    expect(seen.isConfigured).toBe(true);
  });

  it('rolls back and rethrows when the write could not be confirmed', async () => {
    setContext({ instanceId: 55555555 });
    loadSettings.mockResolvedValue(CONFIGURED);
    const boom = new Error('settings write did not persist (read-back mismatch)');
    saveSettings.mockRejectedValue(boom);

    renderProvider();
    await waitFor(() => expect(seen.isLoading).toBe(false));

    let caught;
    await act(async () => {
      await seen.updateSettings({ boardId: '777' }).catch((err) => {
        caught = err;
      });
    });

    expect(caught).toBe(boom);
    // The value that never persisted must not linger in the UI.
    expect(seen.settings.boardId).toBe('18424252636');
  });

  it('starts from the defaults when nothing was stored yet', async () => {
    setContext({ instanceId: 55555555 });
    loadSettings.mockResolvedValue(null);

    renderProvider();
    await waitFor(() => expect(seen.isLoading).toBe(false));

    await act(async () => {
      await seen.updateSettings({ boardId: '777' });
    });

    expect(seen.settings.boardId).toBe('777');
    // The single table block from DEFAULT_SETTINGS survives the first write.
    expect(seen.settings.blocks).toEqual([{ id: 'table', type: 'table' }]);
  });
});

describe('useSettings without a provider', () => {
  it('reports a safe unconfigured value and records the programming error', () => {
    render(<Probe />);

    expect(seen).toEqual(
      expect.objectContaining({ settings: null, isConfigured: false, isLoading: false })
    );
    expect(typeof seen.updateSettings).toBe('function');
  });
});

describe('SettingsGate', () => {
  const renderGate = () =>
    render(
      <SettingsProvider>
        <SettingsGate>
          <div data-testid="app-body">גוף האפליקציה</div>
        </SettingsGate>
      </SettingsProvider>
    );

  it('blocks the children while the blob is still loading', async () => {
    setContext({ instanceId: 55555555 });
    let release;
    loadSettings.mockReturnValue(new Promise((resolve) => { release = resolve; }));

    renderGate();

    expect(screen.queryByTestId('app-body')).toBeNull();
    expect(screen.getByTestId('settings-loading')).toBeInTheDocument();

    await act(async () => {
      release(CONFIGURED);
    });
    await waitFor(() => expect(screen.getByTestId('app-body')).toBeInTheDocument());
  });

  it('force-mounts the settings panel for an owner when the instance is unconfigured', async () => {
    setContext({ instanceId: 55555555 });
    loadSettings.mockResolvedValue(null);

    renderGate();

    await waitFor(() => expect(screen.getByTestId('settings-panel')).toBeInTheDocument());
    expect(screen.getByTestId('settings-panel')).toHaveTextContent('forced');
    expect(screen.queryByTestId('app-body')).toBeNull();
  });

  it('shows a Hebrew notice — never the panel — to a non-owner of an unconfigured instance', async () => {
    setContext({ instanceId: 55555555 });
    loadSettings.mockResolvedValue(null);
    useIsOwner.mockReturnValue({ isOwner: false, isLoading: false });

    renderGate();

    await waitFor(() => expect(screen.getByTestId('settings-not-configured')).toBeInTheDocument());
    expect(screen.queryByTestId('settings-panel')).toBeNull();
    expect(screen.queryByTestId('app-body')).toBeNull();
  });

  it('waits for the ownership answer before choosing panel or notice', async () => {
    setContext({ instanceId: 55555555 });
    loadSettings.mockResolvedValue(null);
    useIsOwner.mockReturnValue({ isOwner: false, isLoading: true });

    renderGate();

    await waitFor(() => expect(screen.getByTestId('settings-loading')).toBeInTheDocument());
    expect(screen.queryByTestId('settings-not-configured')).toBeNull();
    expect(screen.queryByTestId('settings-panel')).toBeNull();
  });

  it('renders the children once the instance is configured', async () => {
    setContext({ instanceId: 55555555 });
    loadSettings.mockResolvedValue(CONFIGURED);

    renderGate();

    await waitFor(() => expect(screen.getByTestId('app-body')).toBeInTheDocument());
    expect(screen.queryByTestId('settings-panel')).toBeNull();
  });

  it('offers the owner a way back into settings once configured', async () => {
    setContext({ instanceId: 55555555 });
    loadSettings.mockResolvedValue(CONFIGURED);

    renderGate();

    await waitFor(() => expect(screen.getByTestId('app-body')).toBeInTheDocument());
    expect(screen.getByTestId('open-settings')).toBeInTheDocument();
  });

  it('gives a non-owner no way into settings', async () => {
    setContext({ instanceId: 55555555 });
    loadSettings.mockResolvedValue(CONFIGURED);
    useIsOwner.mockReturnValue({ isOwner: false, isLoading: false });

    renderGate();

    await waitFor(() => expect(screen.getByTestId('app-body')).toBeInTheDocument());
    expect(screen.queryByTestId('open-settings')).toBeNull();
  });
});
