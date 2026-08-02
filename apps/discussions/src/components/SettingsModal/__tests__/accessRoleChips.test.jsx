import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/*
 * round317 (owner report) — what the owner actually looks at after installing:
 * Settings → מיפוי → לוח משימות → אנשים. The "יכולת עריכה" row must show יוצר,
 * מנהל/מוביל and מרכז דיון TICKED, and "יכולת צפייה" must show משתתפים.
 *
 * Driven through the real modal because that is the surface the report is about;
 * the pure seeding rules are covered in mondayApi/__tests__/accessRolesSeed.test.js.
 */

// A freshly-installed instance: boards + columns from provisioning.
const boards = { discussions: { id: '1' }, tasks: { id: '2' }, topics: { id: '3' }, decisions: { id: '4' } };
const taskCols = {
  taskEditorsID: { id: 'people_ed', type: 'people', title: 'יכולת עריכה' },
  taskViewersID: { id: 'people_vw', type: 'people', title: 'יכולת צפייה' },
};
let stored = null;
const storage = {
  getItem: vi.fn(async (key) => (
    String(key).startsWith('discussions_settings')
      ? { data: { value: stored ? JSON.stringify(stored) : null } }
      : { data: { value: null } }
  )),
  setItem: vi.fn(async () => ({})),
};
vi.mock('../../../utils/mondayApi/monday-client.js', () => ({
  monday: {
    storage: { getItem: (...a) => storage.getItem(...a), setItem: (...a) => storage.setItem(...a) },
    api: vi.fn(async () => ({ data: {} })),
  },
  api: vi.fn(async () => ({
    boards: [{ columns: [
      { id: 'people_ed', title: 'יכולת עריכה', type: 'people' },
      { id: 'people_vw', title: 'יכולת צפייה', type: 'people' },
    ] }],
  })),
  API_VERSION: '2026-07',
  ensureUserPhotoSelection: async () => 'photo_url { small }',
  normalizePhoto: () => null,
}));
vi.mock('../../../utils/mondayApi/board-config-store.js', () => ({
  setActiveConfig: vi.fn(), getBoardId: () => null, getColumns: () => ({}),
}));

import { SettingsModal } from '../SettingsModal.jsx';
import { SettingsProvider } from '../../../contexts/SettingsContext.jsx';
import { MondayContext } from '../../../contexts/MondayContext.jsx';

const Host = () => (
  <MondayContext.Provider value={{ context: { instanceId: 'i1', boardId: 'b1' }, user: null }}>
    <SettingsProvider>
      <SettingsModal isOpen onClose={() => {}} templatesOnly={false} />
    </SettingsProvider>
  </MondayContext.Provider>
);

// Walk to the people folder of the tasks board, where the access rows live.
const openTasksPeople = async () => {
  await waitFor(() => expect(screen.getByText('מיפוי')).toBeTruthy());
  fireEvent.click(screen.getByText('מיפוי'));
  await waitFor(() => expect(screen.getByText('משימות')).toBeTruthy());
  fireEvent.click(screen.getByText('משימות'));
  const people = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'אנשים');
  if (people) fireEvent.click(people);
  await waitFor(() => expect(document.querySelectorAll('.accessRoles').length).toBe(2));
};

// The chips of one access row, as { label: pressed }.
const chipsOf = (index) => {
  const box = document.querySelectorAll('.accessRoles')[index];
  return Object.fromEntries([...box.querySelectorAll('button')].map((b) => [
    b.textContent.replace('✓', '').trim(),
    b.getAttribute('aria-pressed') === 'true',
  ]));
};
const rowLabels = () => [...document.querySelectorAll('.accessRoles')].map((box) => {
  // the access row's own title sits in the row above its chips
  const row = box.closest('.colRow') || box.parentElement;
  return row?.textContent || '';
});

beforeEach(() => {
  stored = { boards, columns: { tasks: taskCols } };
  vi.clearAllMocks();
});

describe('the access-column auto-fill roles as the owner sees them after install', () => {
  it('ticks יוצר, מנהל and מרכז דיון on יכולת עריכה', async () => {
    render(<Host />);
    await openTasksPeople();
    const editorsIndex = rowLabels().findIndex((t) => t.includes('יכולת עריכה'));
    expect(editorsIndex).toBeGreaterThanOrEqual(0);
    expect(chipsOf(editorsIndex)).toEqual({
      'מנהל דיון': true,
      'מרכז דיון': true,
      'יוצר הדיון': true,
      'משתתפים': false,
    });
  });

  it('ticks משתתפים on יכולת צפייה (and only that)', async () => {
    render(<Host />);
    await openTasksPeople();
    const viewersIndex = rowLabels().findIndex((t) => t.includes('יכולת צפייה'));
    expect(viewersIndex).toBeGreaterThanOrEqual(0);
    expect(chipsOf(viewersIndex)).toEqual({
      'מנהל דיון': false,
      'מרכז דיון': false,
      'יוצר הדיון': false,
      'משתתפים': true,
    });
  });

  it('shows the STORED lists once the install seeded them (the round317 state)', async () => {
    stored = {
      boards,
      columns: { tasks: taskCols },
      preferences: { accessRoleSources: { taskEditorsID: ['discussionCreatorID'], taskViewersID: [] } },
    };
    render(<Host />);
    await openTasksPeople();
    const editorsIndex = rowLabels().findIndex((t) => t.includes('יכולת עריכה'));
    expect(chipsOf(editorsIndex)).toEqual({
      'מנהל דיון': false,
      'מרכז דיון': false,
      'יוצר הדיון': true,
      'משתתפים': false,
    });
  });

  it('still ticks the edit roles when the stored accessRoleSources covers only the OTHER column', async () => {
    /*
     * The seed merges preferences SHALLOWLY, so a stored accessRoleSources object
     * replaces the whole default map: an instance that only ever configured
     * "יכולת צפייה" leaves the editors key genuinely missing. That is the path where
     * accessRolesFor's fallback earns its keep — without it, the row the owner asked
     * about would render every chip unticked.
     */
    stored = {
      boards,
      columns: { tasks: taskCols },
      preferences: { accessRoleSources: { taskViewersID: ['participantsID'] } },
    };
    render(<Host />);
    await openTasksPeople();
    const editorsIndex = rowLabels().findIndex((t) => t.includes('יכולת עריכה'));
    expect(chipsOf(editorsIndex)).toEqual({
      'מנהל דיון': true,
      'מרכז דיון': true,
      'יוצר הדיון': true,
      'משתתפים': false,
    });
  });

  it('a click toggles one role and leaves the other row alone', async () => {
    render(<Host />);
    await openTasksPeople();
    const editorsIndex = rowLabels().findIndex((t) => t.includes('יכולת עריכה'));
    const box = document.querySelectorAll('.accessRoles')[editorsIndex];
    const coordinator = [...box.querySelectorAll('button')].find((b) => b.textContent.includes('מרכז דיון'));
    fireEvent.click(coordinator);
    await waitFor(() => expect(chipsOf(editorsIndex)['מרכז דיון']).toBe(false));
    expect(chipsOf(editorsIndex)['מנהל דיון']).toBe(true);
    expect(chipsOf(editorsIndex)['יוצר הדיון']).toBe(true);
    const viewersIndex = rowLabels().findIndex((t) => t.includes('יכולת צפייה'));
    expect(chipsOf(viewersIndex)['משתתפים']).toBe(true);
  });
});
