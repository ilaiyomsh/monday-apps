/*
 * round332 — the permissions tab's section chrome:
 *
 *  1. The explanatory captions ("התפקידים נקבעים לפי עמודות האנשים…") are GONE
 *     from every section head (owner request).
 *  2. "תפקידי האפליקציה — שיוך משתמשים" is a REAL collapsible section like the
 *     matrices: rendered as a head button, collapsed by default, opens on click
 *     and closes on a second click.
 *
 * The mocks mirror permissionsTab.persistence.test.jsx — the tab pulls the
 * monday client transitively through BoardPeoplePicker.
 */
import React, { useState } from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const storageState = { value: null, setItem: vi.fn(), getItem: vi.fn() };
vi.mock('../../../utils/mondayApi/monday-client.js', () => ({
  monday: {
    storage: {
      getItem: (...a) => storageState.getItem(...a),
      setItem: (...a) => storageState.setItem(...a),
    },
    api: vi.fn(async () => ({ data: {} })),
  },
  api: vi.fn(async () => ({})),
  API_VERSION: '2026-07',
  ensureUserPhotoSelection: async () => 'photo_url { small }',
  normalizePhoto: (u) => u?.photo_url?.small ?? u?.photo_thumb ?? null,
}));
vi.mock('../../../utils/mondayApi/board-config-store.js', () => ({
  setActiveConfig: vi.fn(),
  getBoardId: () => null,
  getColumns: () => ({}),
}));

import PermissionsTab from '../PermissionsTab.jsx';
import { SettingsProvider } from '../../../contexts/SettingsContext.jsx';
import { MondayContext } from '../../../contexts/MondayContext.jsx';
import { DEFAULT_PERMISSIONS } from '../../../utils/mondayApi/boards.config.js';

const COLUMNS = {
  discussions: {
    discussionCreatorID: { title: 'יוצר דיון', type: 'people' },
    participantsID: { title: 'משתתפים', type: 'people' },
  },
  tasks: { taskCreatorID: { title: 'יוצר', type: 'people' } },
};

function Harness() {
  const [permissions, setPermissions] = useState({ ...DEFAULT_PERMISSIONS });
  return (
    <PermissionsTab permissions={permissions} setPermissions={setPermissions} columns={COLUMNS} />
  );
}

function renderTab() {
  const ctxValue = { context: { instanceId: 'inst1' }, currentUser: null, isMobile: false };
  return render(
    <MondayContext.Provider value={ctxValue}>
      <SettingsProvider>
        <Harness />
      </SettingsProvider>
    </MondayContext.Provider>
  );
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

describe('round332 — section chrome', () => {
  it('renders NO explanatory caption in any section head', async () => {
    await act(async () => { renderTab(); });
    expect(screen.queryByText(/התפקידים נקבעים לפי עמודות האנשים/)).toBeNull();
    expect(screen.queryByText(/פעולות גלובליות — לפי תפקיד האפליקציה/)).toBeNull();
  });

  it('renders the app-roles assignment as a collapsible section head', async () => {
    await act(async () => { renderTab(); });
    const head = screen.getByRole('button', { name: /תפקידי האפליקציה — שיוך משתמשים/ });
    expect(head).toHaveAttribute('aria-expanded', 'false');
  });

  it('keeps the app-roles body hidden until the head is clicked', async () => {
    await act(async () => { renderTab(); });
    // The SUPER MEMBERS card lives in the section body — absent while collapsed.
    expect(screen.queryByText('SUPER MEMBERS')).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /תפקידי האפליקציה — שיוך משתמשים/ }));
    });
    expect(screen.getByText('SUPER MEMBERS')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /תפקידי האפליקציה — שיוך משתמשים/ })
    ).toHaveAttribute('aria-expanded', 'true');
  });

  it('closes the app-roles body on a second click', async () => {
    await act(async () => { renderTab(); });
    const name = /תפקידי האפליקציה — שיוך משתמשים/;
    await act(async () => { fireEvent.click(screen.getByRole('button', { name })); });
    expect(screen.getByText('SUPER MEMBERS')).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name })); });
    expect(screen.queryByText('SUPER MEMBERS')).toBeNull();
  });

  it('still opens a matrix section by its (caption-less) title alone', async () => {
    await act(async () => { renderTab(); });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'דיון ונושאים' }));
    });
    // A capability row from the disc matrix proves the table rendered.
    expect(screen.getByText('צפייה בדיון')).toBeInTheDocument();
  });
});
