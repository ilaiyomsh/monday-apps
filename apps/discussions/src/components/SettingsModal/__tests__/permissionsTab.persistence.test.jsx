import React, { useState } from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mock storage so we can assert the EXACT persisted permissions shape -----
const storageState = { value: null, setItem: vi.fn(), getItem: vi.fn() };
vi.mock('../../../utils/mondayApi/monday-client.js', () => ({
  monday: {
    storage: {
      getItem: (...a) => storageState.getItem(...a),
      setItem: (...a) => storageState.setItem(...a),
    },
    api: vi.fn(async () => ({ data: {} })),
  },
  // subscribers.js (pulled in via BoardPeoplePicker) imports these at load time.
  api: vi.fn(async () => ({})),
  API_VERSION: '2026-07',
  ensureUserPhotoSelection: async () => 'photo_url { small }',
  normalizePhoto: (u) => u?.photo_url?.small ?? u?.photo_thumb ?? null,
}));

const setActiveConfig = vi.fn();
vi.mock('../../../utils/mondayApi/board-config-store.js', () => ({
  setActiveConfig: (...a) => setActiveConfig(...a),
  // peopleColumns.js reads these; return empty so ensurePeopleColumns() no-ops
  // (no board id ⇒ the role list falls back to the mapped-alias columns).
  getBoardId: () => null,
  getColumns: () => ({}),
}));

import PermissionsTab from '../PermissionsTab.jsx';
import { SettingsProvider, useSettings } from '../../../contexts/SettingsContext.jsx';
import { MondayContext } from '../../../contexts/MondayContext.jsx';
import { DEFAULT_PERMISSIONS, DEFAULT_PERMISSION_SEED } from '../../../utils/mondayApi/boards.config.js';

// Column titles drive the role list labels; roles are derived from people-type
// columns (matches mergeColumnsWithSchema, which always carries `type`).
const COLUMNS = {
  discussions: {
    discussionCreatorID: { title: 'יוצר דיון', type: 'people' },
    discussionLeadID: { title: 'מוביל דיון', type: 'people' },
    participantsID: { title: 'משתתפים', type: 'people' },
  },
  tasks: {
    taskCreatorID: { title: 'יוצר', type: 'people' },
    responsibilityID: { title: 'אחריות', type: 'people' },
  },
};

// Harness: mirrors how SettingsModal wires PermissionsTab — a permissions draft
// in local state + a "save" button that pushes the whole object through
// updateSettings (the persistence path under test).
function Harness() {
  const { settings, updateSettings } = useSettings();
  const [permissions, setPermissions] = useState({
    ...DEFAULT_PERMISSIONS,
    ...(settings?.permissions || {}),
  });
  const [selectedRoleKey, setSelectedRoleKey] = useState(null);
  return (
    <>
      <PermissionsTab
        permissions={permissions}
        setPermissions={setPermissions}
        columns={COLUMNS}
        selectedRoleKey={selectedRoleKey}
        onSelectRole={setSelectedRoleKey}
      />
      <button type="button" onClick={() => updateSettings({ permissions })}>
        save
      </button>
    </>
  );
}

function renderHarness() {
  const ctxValue = { context: { instanceId: 'inst1' }, currentUser: null, isMobile: false };
  return render(
    <MondayContext.Provider value={ctxValue}>
      <SettingsProvider>
        <Harness />
      </SettingsProvider>
    </MondayContext.Provider>
  );
}

function lastWritten() {
  const calls = storageState.setItem.mock.calls;
  if (!calls.length) return null;
  return JSON.parse(calls[calls.length - 1][1]);
}

beforeEach(() => {
  vi.clearAllMocks();
  storageState.value = JSON.stringify({
    boards: { discussions: { id: 'B1' }, tasks: { id: 'B2' }, topics: { id: 'B3' } },
    columns: { discussions: {}, tasks: {}, topics: {} },
  });
  storageState.getItem = vi.fn(async () => ({ data: { value: storageState.value } }));
  storageState.setItem = vi.fn(async () => ({}));
});

describe('PermissionsTab persistence round-trip', () => {
  it('is always-on: auto-seeds from the LOCKED seed and persists the whole permissions object', async () => {
    renderHarness();
    await waitFor(() => expect(screen.getByText('save')).toBeTruthy());

    // No enable toggle — permissions are always on. The mount effect forces
    // enabled:true and pre-fills the roles from the LOCKED seed; flush it.
    await act(async () => {});

    await act(async () => { fireEvent.click(screen.getByText('save')); });

    const written = lastWritten();
    expect(written.permissions.enabled).toBe(true);
    expect(written.permissions.version).toBe(1);
    // Auto-seeded from DEFAULT_PERMISSION_SEED on mount.
    expect(written.permissions.roles).toEqual(DEFAULT_PERMISSION_SEED);
    // No transient UI state leaked into storage.
    expect(written.permissions).not.toHaveProperty('_selectedRole');
  });

  it('toggling a capability checkbox round-trips into stored roles', async () => {
    renderHarness();
    await waitFor(() => expect(screen.getByText('save')).toBeTruthy());
    await act(async () => {}); // flush the always-on seed effect

    // The first tier is "כללי" (system), so select the discussion-creator role
    // explicitly (seeded with editSummary:true). Then flip "עריכת סיכום" off.
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'יוצר דיון' })); });
    const editSummary = screen.getByLabelText('עריכת סיכום');
    await act(async () => { fireEvent.click(editSummary); });

    await act(async () => { fireEvent.click(screen.getByText('save')); });

    const written = lastWritten();
    expect(
      written.permissions.roles['discussions:discussionCreatorID'].capabilities.editSummary
    ).toBe(false);
    // A sibling capability is untouched.
    expect(
      written.permissions.roles['discussions:discussionCreatorID'].capabilities.editDiscussionFields
    ).toBe(true);
  });

  it('exposes the system tier role and round-trips a system capability grant', async () => {
    renderHarness();
    await waitFor(() => expect(screen.getByText('save')).toBeTruthy());
    await act(async () => {}); // flush the always-on seed effect

    // "כללי" (system) is the FIRST tier and selected by default, so there are two
    // "כללי" buttons — the sidebar role button (first in the DOM) and the card
    // head. Click the sidebar one to be explicit.
    const systemRoleBtn = screen.getAllByRole('button', { name: 'כללי' })[0];
    await act(async () => { fireEvent.click(systemRoleBtn); });

    // System capabilities are reachable as checkbox rows.
    const createDiscussion = screen.getByLabelText('יצירת דיון');
    await act(async () => { fireEvent.click(createDiscussion); });

    await act(async () => { fireEvent.click(screen.getByText('save')); });

    const written = lastWritten();
    expect(
      written.permissions.roles['system:system'].capabilities.createDiscussion
    ).toBe(true);
  });

  it('seeds the new מרכז דיון (coordinator) role on mount', async () => {
    renderHarness();
    await waitFor(() => expect(screen.getByText('save')).toBeTruthy());
    await act(async () => {}); // flush the always-on seed effect

    await act(async () => { fireEvent.click(screen.getByText('save')); });

    const written = lastWritten();
    expect(written.permissions.enabled).toBe(true);
    // The coordinator role is part of the seed and edits like the lead.
    const coord = written.permissions.roles['discussions:discussionCoordinatorID'];
    expect(coord).toBeTruthy();
    expect(coord.capabilities.editDiscussionFields).toBe(true);
  });
});
