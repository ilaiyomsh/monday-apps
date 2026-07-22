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
    discussionCoordinatorID: { title: 'מרכז דיון', type: 'people' },
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

    // round212 — the matrix: the discussion-creator × כתיבת סיכום cell is a ✓
    // cell (seeded editSummary:true). Clicking it flips the grant to false.
    const cell = screen.getByTestId('mx-discussions:discussionCreatorID-editSummary');
    expect(cell.textContent).toContain('✓');
    await act(async () => { fireEvent.click(cell); });

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

    // round212 — the system matrix: the Members × יצירת דיון cell writes the
    // system:system pseudo-role.
    const cell = screen.getByTestId('mx-system:system-createDiscussion');
    await act(async () => { fireEvent.click(cell); });

    await act(async () => { fireEvent.click(screen.getByText('save')); });

    const written = lastWritten();
    expect(
      written.permissions.roles['system:system'].capabilities.createDiscussion
    ).toBe(true);
  });

  it('round219: the coordinator column is driven by MAPPING — present when mapped, no switch/sentence', async () => {
    // COLUMNS maps discussionCoordinatorID (people) → the column is present, and
    // the old "לא עובדים עם מרכז דיון" sentence + checkbox are gone (round219).
    renderHarness();
    await waitFor(() => expect(screen.getByText('save')).toBeTruthy());
    await act(async () => {}); // flush the always-on seed effect

    expect(screen.getByTestId('mx-discussions:discussionCoordinatorID-editSummary')).toBeTruthy();
    expect(screen.queryByText(/לא עובדים עם מרכז דיון/)).toBeNull();

    // Saving never writes a noCoordinator flag anymore.
    await act(async () => { fireEvent.click(screen.getByText('save')); });
    expect(lastWritten().permissions.noCoordinator).toBeUndefined();
  });

  it('round219: an UNMAPPED coordinator column simply does not appear', async () => {
    const cols = { ...COLUMNS, discussions: { ...COLUMNS.discussions } };
    delete cols.discussions.discussionCoordinatorID;
    render(
      <MondayContext.Provider value={{ context: { instanceId: 'inst1' }, currentUser: null, isMobile: false }}>
        <PermissionsTab
          permissions={{ ...DEFAULT_PERMISSIONS, enabled: true, roles: JSON.parse(JSON.stringify(DEFAULT_PERMISSION_SEED)) }}
          setPermissions={() => {}}
          columns={cols}
        />
      </MondayContext.Provider>
    );
    await act(async () => {});
    expect(screen.queryByTestId('mx-discussions:discussionCoordinatorID-editSummary')).toBeNull();
    // The other role columns are unaffected.
    expect(screen.getByTestId('mx-discussions:discussionLeadID-editSummary')).toBeTruthy();
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
