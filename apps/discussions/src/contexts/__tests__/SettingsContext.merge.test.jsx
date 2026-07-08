import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, act, waitFor } from '@testing-library/react';

// --- Mocks -----------------------------------------------------------------
// Capture every write so we can assert the EXACT stored shape (deep-merge must
// preserve siblings AND must not pollute instances that never use a key).
const storageState = { value: null, setItem: vi.fn(), getItem: vi.fn() };

vi.mock('../../utils/mondayApi/monday-client.js', () => ({
  monday: {
    storage: {
      getItem: (...a) => storageState.getItem(...a),
      setItem: (...a) => storageState.setItem(...a),
    },
  },
}));

// Don't care what the SDK store receives here — just stub it.
const setActiveConfig = vi.fn();
vi.mock('../../utils/mondayApi/board-config-store.js', () => ({
  setActiveConfig: (...a) => setActiveConfig(...a),
}));

import { SettingsProvider, useSettings } from '../SettingsContext.jsx';
import { MondayContext } from '../MondayContext.jsx';

// Harness: render the provider, expose the live context value through a ref so
// the test can call updateSettings and read the resulting settings.
function renderSettings() {
  const ref = { current: null };
  function Capture() {
    ref.current = useSettings();
    return null;
  }
  const ctxValue = { context: { instanceId: 'inst1' }, currentUser: null, isMobile: false };
  render(
    <MondayContext.Provider value={ctxValue}>
      <SettingsProvider>
        <Capture />
      </SettingsProvider>
    </MondayContext.Provider>
  );
  return ref;
}

// The JSON written on the latest setItem call.
function lastWritten() {
  const calls = storageState.setItem.mock.calls;
  if (!calls.length) return null;
  return JSON.parse(calls[calls.length - 1][1]);
}

beforeEach(() => {
  vi.clearAllMocks();
  storageState.value = null;
  storageState.getItem = vi.fn(async () => ({ data: { value: storageState.value } }));
  storageState.setItem = vi.fn(async () => ({}));
});

async function mountedWith(initial) {
  storageState.value = initial ? JSON.stringify(initial) : null;
  const ref = renderSettings();
  await waitFor(() => expect(ref.current.isLoading).toBe(false));
  return ref;
}

describe('updateSettings deep-merge', () => {
  it('preferences: partial write preserves an existing sibling', async () => {
    // Instance already has previousTasksMode set.
    const ref = await mountedWith({
      boards: { discussions: { id: 'B1' }, tasks: { id: 'B2' }, topics: { id: 'B3' } },
      columns: { discussions: {}, tasks: {}, topics: {} },
      preferences: { previousTasksMode: 'discussionType' },
    });

    await act(async () => {
      await ref.current.updateSettings({ preferences: { showMyTasks: true } });
    });

    const written = lastWritten();
    expect(written.preferences).toEqual({
      previousTasksMode: 'discussionType',
      showMyTasks: true,
    });
    expect(ref.current.settings.preferences.previousTasksMode).toBe('discussionType');
  });

  it('permissions.roles: two sequential partial role writes keep BOTH roles', async () => {
    const ref = await mountedWith({
      boards: { discussions: { id: 'B1' }, tasks: { id: 'B2' }, topics: { id: 'B3' } },
      columns: { discussions: {}, tasks: {}, topics: {} },
    });

    await act(async () => {
      await ref.current.updateSettings({ permissions: { roles: { roleA: { canEdit: true } } } });
    });
    await act(async () => {
      await ref.current.updateSettings({ permissions: { roles: { roleB: { canEdit: false } } } });
    });

    const written = lastWritten();
    expect(written.permissions.roles).toEqual({
      roleA: { canEdit: true },
      roleB: { canEdit: false },
    });
    expect(ref.current.settings.permissions.roles).toEqual({
      roleA: { canEdit: true },
      roleB: { canEdit: false },
    });
  });

  it('does NOT pollute settings with permissions/preferences when neither base nor partial has them', async () => {
    const ref = await mountedWith({
      boards: { discussions: { id: 'B1' }, tasks: { id: 'B2' }, topics: { id: 'B3' } },
      columns: { discussions: {}, tasks: {}, topics: {} },
    });

    await act(async () => {
      await ref.current.updateSettings({ boards: { discussions: { id: 'B1-changed' } } });
    });

    const written = lastWritten();
    expect(written).not.toHaveProperty('permissions');
    expect(written).not.toHaveProperty('preferences');
    expect(written.boards.discussions.id).toBe('B1-changed');
  });
});
