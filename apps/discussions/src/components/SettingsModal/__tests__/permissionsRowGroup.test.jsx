import React, { useState } from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/*
 * round335 — the group heading is a BOXED CELL BESIDE its rows, not a row above them.
 *
 * The visual half (136px column, grey tint, both-axis centring) is CSS-module only
 * and unobservable in jsdom. What IS observable, and what a careless edit silently
 * breaks, is the table's SHAPE:
 *
 *   1. The heading is a `th[scope=rowgroup]` with `rowSpan` = its group's cap count,
 *      sitting on the group's FIRST row — not a `td[colSpan]` row of its own.
 *   2. It is the row's FIRST cell, which in an RTL table is the rightmost one.
 *   3. thead grew one leading placeholder cell, so header and body agree on the
 *      column count. Disagreement here shifts every ✓ one column sideways — a
 *      permissions matrix that lies about who can do what.
 *   4. A one-capability group still gets a box (rowSpan=1), per owner decision.
 *
 * Mocks mirror permissionsTab.persistence.test.jsx.
 */

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
import { CAP_GROUP_LABELS } from '../permissionsGrouping.js';

const COLUMNS = {
  discussions: {
    discussionCreatorID: { title: 'יוצר דיון', type: 'people' },
    discussionLeadID: { title: 'מוביל דיון', type: 'people' },
    participantsID: { title: 'משתתפים', type: 'people' },
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

async function openDiscTier() {
  await act(async () => { renderTab(); });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'דיון ונושאים' })); });
  // The disc tier is the matrix carrying the discussion-group heading.
  return Array.from(document.querySelectorAll('table'))
    .find((t) => t.textContent.includes(CAP_GROUP_LABELS.discussion));
}

/** The rowgroup heading cell whose text is `label`. */
const groupCell = (table, label) =>
  Array.from(table.querySelectorAll('th[scope="rowgroup"]'))
    .find((th) => th.textContent.trim() === label);

beforeEach(() => {
  vi.clearAllMocks();
  storageState.value = JSON.stringify({
    boards: { discussions: { id: 'B1' }, tasks: { id: 'B2' }, topics: { id: 'B3' } },
    columns: { discussions: {}, tasks: {}, topics: {} },
  });
  storageState.getItem = vi.fn(async () => ({ data: { value: storageState.value } }));
  storageState.setItem = vi.fn(async () => ({}));
});

describe('round335 — group heading as a rowspanning side cell', () => {
  it('renders the group label as a th[scope=rowgroup], not a colSpan row', async () => {
    const table = await openDiscTier();
    const cell = groupCell(table, CAP_GROUP_LABELS.discussion);
    expect(cell).toBeTruthy();
    // No heading cell anywhere still spans the table horizontally.
    const spanners = Array.from(table.querySelectorAll('tbody td[colspan]'));
    expect(spanners).toHaveLength(0);
  });

  it('puts the heading FIRST in its row (rightmost in RTL)', async () => {
    const table = await openDiscTier();
    const cell = groupCell(table, CAP_GROUP_LABELS.discussion);
    expect(cell.parentElement.firstElementChild).toBe(cell);
  });

  it('spans exactly the rows of its own group', async () => {
    const table = await openDiscTier();
    const cell = groupCell(table, CAP_GROUP_LABELS.discussion);
    const span = Number(cell.getAttribute('rowspan'));
    expect(span).toBeGreaterThan(1);
    // The spanned block must end where the NEXT group's heading begins: counting
    // from this heading's row, exactly `span` rows pass before the next one.
    const rows = Array.from(table.querySelectorAll('tbody tr'));
    const start = rows.indexOf(cell.parentElement);
    const nextHeadingRow = rows.findIndex(
      (r, i) => i > start && r.querySelector('th[scope="rowgroup"]')
    );
    expect(nextHeadingRow).toBe(start + span);
  });

  it('gives a single-capability group its own box (rowspan=1)', async () => {
    const table = await openDiscTier();
    // "משימות" in this tier holds exactly one capability (יצירת משימה בדיון).
    const cell = groupCell(table, CAP_GROUP_LABELS.tasks);
    expect(cell).toBeTruthy();
    expect(cell.getAttribute('rowspan')).toBe('1');
  });

  it('keeps thead and tbody on the same column count', async () => {
    const table = await openDiscTier();
    const headCells = table.querySelectorAll('thead tr > *').length;
    // A body row that carries the heading: heading + action + one cell per role.
    const withHeading = groupCell(table, CAP_GROUP_LABELS.discussion).parentElement;
    expect(withHeading.children.length).toBe(headCells);
  });
});
