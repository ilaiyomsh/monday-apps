/*
 * round333 — the permissions matrices' reading order and dropped chrome:
 *
 *  1. The discussions matrix orders its role columns creator → lead →
 *     coordinator → participants EVEN WHEN the live board columns arrive in a
 *     different order (they arrive in board-creation order, which is arbitrary).
 *     The live list here is deliberately SCRAMBLED to pin that.
 *  2. The system matrix reads Owners → Super Members → Members (RTL: Owners
 *     rightmost).
 *  3. The empty-coordinator/Owners-bypass footnote is gone.
 *
 * Mocks mirror permissionsTab.persistence.test.jsx, plus peopleColumns so the
 * LIVE-columns path (the one the sort exists for) is the path under test.
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
// Live people columns in SCRAMBLED board order — the sort under test must undo it.
vi.mock('../../../utils/mondayApi/peopleColumns.js', () => ({
  getPeopleColumns: (boardKey) =>
    boardKey === 'discussions'
      ? [
          { id: 'col_part', title: 'משתתפים' },
          { id: 'col_coord', title: 'מרכז דיון' },
          { id: 'col_creator', title: 'יוצר דיון' },
          { id: 'col_lead', title: 'מוביל דיון' },
        ]
      : [],
  ensurePeopleColumns: () => {},
  subscribe: () => () => {},
  getVersion: () => 0,
}));

import PermissionsTab from '../PermissionsTab.jsx';
import { SettingsProvider } from '../../../contexts/SettingsContext.jsx';
import { MondayContext } from '../../../contexts/MondayContext.jsx';
import { DEFAULT_PERMISSIONS } from '../../../utils/mondayApi/boards.config.js';

// The mapped aliases point at the scrambled live column ids above.
const COLUMNS = {
  discussions: {
    discussionCreatorID: { id: 'col_creator', title: 'יוצר דיון', type: 'people' },
    discussionLeadID: { id: 'col_lead', title: 'מוביל דיון', type: 'people' },
    discussionCoordinatorID: { id: 'col_coord', title: 'מרכז דיון', type: 'people' },
    participantsID: { id: 'col_part', title: 'משתתפים', type: 'people' },
  },
  tasks: {},
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

async function openSection(nameRe) {
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: nameRe })); });
}

/** DOM order of a matrix's role-column headers = the RTL right-to-left order. */
function headerTitles(table) {
  return Array.from(table.querySelectorAll('thead th'))
    .map((th) => th.textContent.trim())
    .filter(Boolean);
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

describe('round333 — matrix reading order + dropped chrome', () => {
  it('orders the discussions roles creator → lead → coordinator → participants despite scrambled board order', async () => {
    await act(async () => { renderTab(); });
    await openSection(/דיון ונושאים/);
    const table = document.querySelector('table');
    const titles = headerTitles(table).map((t) => t.replace(/\s+/g, ' '));
    const idx = (name) => titles.findIndex((t) => t.includes(name));
    expect(idx('יוצר דיון')).toBeGreaterThanOrEqual(0);
    expect(idx('יוצר דיון')).toBeLessThan(idx('מוביל דיון'));
    expect(idx('מוביל דיון')).toBeLessThan(idx('מרכז דיון'));
    expect(idx('מרכז דיון')).toBeLessThan(idx('משתתפים'));
  });

  it('orders the system matrix Owners → Super Members → Members', async () => {
    await act(async () => { renderTab(); });
    await openSection(/מערכת/);
    const tables = Array.from(document.querySelectorAll('table'));
    const sysTable = tables.find((t) => t.textContent.includes('Owners'));
    const titles = headerTitles(sysTable);
    // startsWith, not includes: "Super Members" CONTAINS "Members", so includes()
    // resolved both lookups to the same header and the last assertion compared an
    // index with itself.
    const idx = (name) => titles.findIndex((t) => t.startsWith(name));
    expect(idx('Owners')).toBeGreaterThanOrEqual(0);
    expect(idx('Owners')).toBeLessThan(idx('Super Members'));
    expect(idx('Super Members')).toBeLessThan(idx('Members'));
  });

  it('keeps the system body cells aligned with the reordered header (Owners locked-✓ first)', async () => {
    await act(async () => { renderTab(); });
    await openSection(/מערכת/);
    const tables = Array.from(document.querySelectorAll('table'));
    const sysTable = tables.find((t) => t.textContent.includes('Owners'));
    const firstRowCells = Array.from(sysTable.querySelectorAll('tbody tr')[0].querySelectorAll('td'));
    // cell 0 = the action label; cell 1 = the FIRST role column = Owners, which is
    // always the locked "תמיד" grant. Misalignment here means the header moved
    // without the body (the exact bug a header-only reorder would create).
    expect(firstRowCells[1].textContent).toContain('תמיד');
  });

  it('renders NO empty-coordinator/Owners-bypass footnote', async () => {
    await act(async () => { renderTab(); });
    await openSection(/דיון ונושאים/);
    expect(screen.queryByText(/דיון שעמודת "מרכז דיון" שלו ריקה/)).toBeNull();
    expect(screen.queryByText(/אינם מוגבלים ע"י הטבלאות/)).toBeNull();
  });
});
