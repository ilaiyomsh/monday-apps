import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/*
 * round340 (owner-reported from a fresh-account install) — "תאריך יצירה (נקודה) לא
 * ממופה, אפילו שיש בסאבאייטם עמודה של תאריך יצירה".
 *
 * The diagnosis was NOT a provisioning gap: pointCreationDateID has been in
 * PROVISION_SPEC.topics.subitems since round312 and the wizard maps it. The bug was in
 * this screen. `SUBITEM_FIELDS` — the set that decides whether a row's dropdown lists
 * the parent board's columns or the SUBITEMS board's — was hand-maintained and was
 * missing this alias. So the row offered the parent topics board's date columns, the
 * stored subitem column id matched none of them, and SearchablePicker fell back to its
 * placeholder: the row read as unmapped while the mapping was in fact correct. Worse,
 * saving the screen in that state would have written the emptiness back over it.
 *
 * The fix derives SUBITEM_FIELDS from COLUMN_SCHEMA's own `subitems: true` flag, so a
 * future subitem alias cannot reintroduce the drift. These tests pin the observable
 * consequence — which board's columns each row offers — rather than the set itself,
 * because the set is component-local and the board choice is what the owner sees.
 */

const boards = { discussions: { id: '1' }, tasks: { id: '2' }, topics: { id: '3' }, decisions: { id: '4' } };

// The parent topics board and its SUBITEMS board each carry a date column, with
// DIFFERENT titles — that asymmetry is what makes the assertions able to tell which
// board a row read from. (On a real provisioned board both are titled "תאריך יצירה";
// distinct titles here isolate the behaviour under test.)
const PARENT_BOARD_ID = '3';
const SUB_BOARD_ID = '77';
const PARENT_DATE = { id: 'date_parent', title: 'תאריך יצירה של נושא', type: 'date' };
const SUB_DATE = { id: 'date_sub', title: 'תאריך יצירה של נקודה', type: 'date' };

// A correctly-provisioned instance: the point date IS mapped, to the subitems column.
const topicCols = {
  topicCreationDateID: { id: PARENT_DATE.id, type: 'date', title: 'תאריך יצירה' },
  pointCreationDateID: { id: SUB_DATE.id, type: 'date', title: 'תאריך יצירה (נקודה)', subitems: true },
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
  /*
   * The column read is per board id. The topics board also exposes a `subtasks` column
   * whose settings_str points at the subitems board — that is exactly how the modal
   * discovers the subitems board id, so the fixture has to carry it or the row has no
   * board to read at all.
   */
  api: vi.fn(async (_q, vars) => {
    const id = String(vars?.boardId?.[0] ?? vars?.boardId ?? '');
    if (id === PARENT_BOARD_ID) {
      return {
        boards: [{ columns: [
          PARENT_DATE,
          { id: 'sub', title: 'Subitems', type: 'subtasks', settings_str: JSON.stringify({ boardIds: [SUB_BOARD_ID] }) },
        ] }],
      };
    }
    if (id === SUB_BOARD_ID) return { boards: [{ columns: [SUB_DATE] }] };
    return { boards: [{ columns: [] }] };
  }),
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

// Walk to the topics board's date folder, where both creation-date rows live.
const openTopicsDates = async () => {
  await waitFor(() => expect(screen.getByText('מיפוי')).toBeTruthy());
  fireEvent.click(screen.getByText('מיפוי'));
  await waitFor(() => expect(screen.getByText('נושאים לדיון')).toBeTruthy());
  fireEvent.click(screen.getByText('נושאים לדיון'));
  const dates = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'תאריכים');
  if (dates) fireEvent.click(dates);
  await waitFor(() => expect(document.querySelectorAll('.colRow').length).toBeGreaterThan(0));
};

// The picker trigger text of the row whose label contains `label`.
const triggerTextFor = (label) => {
  const row = [...document.querySelectorAll('.colRow')]
    .find((r) => (r.querySelector('.colLabel')?.textContent || '').includes(label));
  return row ? (row.textContent || '').replace(label, '').trim() : null;
};

beforeEach(() => {
  stored = { boards, columns: { topics: topicCols } };
  vi.clearAllMocks();
});

describe('round340 — a subitem mapping row reads the SUBITEMS board', () => {
  /*
   * The regression itself. Before the fix this row showed the placeholder, because the
   * stored `date_sub` was compared against the PARENT board's options.
   */
  it('shows the point creation-date row as MAPPED, naming the subitems column', async () => {
    render(<Host />);
    await openTopicsDates();
    const text = triggerTextFor('תאריך יצירה (נקודה)');
    expect(text).toContain(SUB_DATE.title);
  });

  // And it must not have swung the other way: the TOPIC-level row still reads the
  // parent board, which is the case that already worked and must keep working.
  it('leaves the topic creation-date row reading the parent board', async () => {
    render(<Host />);
    await openTopicsDates();
    const text = triggerTextFor('תאריך יצירה');
    expect(text).toContain(PARENT_DATE.title);
  });

  /*
   * The two rows must resolve to DIFFERENT columns. This is the assertion that catches
   * the subtler failure: a fix that pointed both rows at the same board would satisfy
   * one of the tests above and still be wrong.
   */
  it('the two creation-date rows do not resolve to the same column', async () => {
    render(<Host />);
    await openTopicsDates();
    const pointText = triggerTextFor('תאריך יצירה (נקודה)');
    const topicText = triggerTextFor('תאריך יצירה');
    expect(pointText).not.toContain(PARENT_DATE.title);
    expect(topicText).not.toContain(SUB_DATE.title);
  });
});
