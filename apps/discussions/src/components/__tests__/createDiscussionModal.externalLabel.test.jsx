import React from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/*
 * round278 — front-end verification (with fake data) of the external-participants
 * label in the create/duplicate discussion card.
 *
 * The BUG condition: the mapped monday long_text column is titled "משתתפים".
 * Before the fix the label was derived from that column title (getColumnTitle),
 * so the field read "משתתפים" instead of "משתתפים חיצוניים". This test wires
 * fake data that reproduces exactly that (column mapped + title "משתתפים") and
 * asserts the rendered label is the hardcoded "משתתפים חיצוניים" — matching
 * DiscussionCard's fixed label. Reverting the hardcode makes this test fail.
 */

const mondayMock = vi.hoisted(() => ({ value: { currentUser: { id: '1', name: 'בדיקה' }, context: null } }));
vi.mock('@generated/contexts/MondayContext.jsx', async () => {
  const R = await import('react');
  return {
    useMondayContext: () => mondayMock.value,
    MondayContext: R.createContext(mondayMock.value),
  };
});

vi.mock('@generated/contexts/SettingsContext.jsx', () => ({
  useSettings: () => ({
    settings: { preferences: {} },
    permissions: { enabled: true, version: 1, roles: {} },
    updateSettings: async () => {},
  }),
}));

const templatesValue = vi.hoisted(() => ({ templates: [], participantTemplates: [] }));
vi.mock('@generated/contexts/TemplatesContext.jsx', () => ({
  useTemplates: () => templatesValue,
}));

vi.mock('@generated/utils/mondayApi/hooks/use-users.js', () => ({
  useUsers: () => ({ users: [] }),
}));

vi.mock('@generated/hooks/useStatusOptions.js', () => ({
  useStatusOptions: () => ({ options: [], colorById: {} }),
}));

vi.mock('@api/BoardSDK.js', () => {
  class Board {
    items() { return this; }
    withColumns() { return this; }
    orderBy() { return this; }
    withPagination() { return this; }
    async execute() { return { items: [], cursor: null }; }
    item() { return { create: () => ({ execute: async () => ({ id: '99' }) }), update: () => ({ execute: async () => ({}) }) }; }
    async itemById() { return null; }
  }
  return { דיונים1Board: Board };
});

vi.mock('@generated/utils/mondayApi/monday-client.js', () => ({
  api: vi.fn(async () => ({ items: [] })),
  parseValue: vi.fn(() => null),
  cvSelection: () => '',
}));

// FAKE DATA: the external-participants long_text column IS mapped (so the field
// renders), and the discussions participants column is also mapped.
vi.mock('@generated/utils/mondayApi/board-config-store.js', () => ({
  getColumns: () => ({
    externalParticipantsID: { id: 'long_text_ext' },
    participantsID: { id: 'people_participants' },
  }),
  getBoardId: () => null,
}));

// FAKE DATA: every mapped column title resolves to "משתתפים" — this is the exact
// bug condition. The regular participants field will therefore read "משתתפים";
// the external field must still read "משתתפים חיצוניים" (hardcoded).
vi.mock('@generated/utils/mondayApi/peopleColumns.js', () => ({
  subscribe: () => () => {},
  getVersion: () => 0,
  getPeopleColumns: () => ({}),
  getPeopleColumnIds: () => [],
  getColumnTitle: () => 'משתתפים',
  isColumnMapped: (_board, alias) => alias === 'participantsID' || alias === 'externalParticipantsID',
  ensurePeopleColumns: () => {},
}));

vi.mock('@generated/utils/templates.js', () => ({
  createTopicsFromTemplate: vi.fn(),
  countPoints: () => 0,
  readDiscussionTopicsAsTemplate: vi.fn(async () => ({ topics: [] })),
}));

vi.mock('@generated/components/DatePickerPopover', () => ({
  DatePickerPopover: ({ value, onChange }) => (
    <div data-testid="date-picker">
      <input type="date" onChange={(e) => onChange(e.target.value ? new Date(`${e.target.value}T00:00:00`) : null)} />
      {value && <button type="button" aria-label="ניקוי תאריך" onClick={() => onChange(null)}>clear</button>}
    </div>
  ),
}));

vi.mock('@generated/components/PersonPicker', () => ({
  PersonPicker: ({ selected = [], onChange }) => (
    <div data-testid="person-picker">
      <button type="button" onClick={() => onChange([{ id: 'p1', name: 'איש', kind: 'person' }])}>
        add-person ({selected.length})
      </button>
    </div>
  ),
}));

import { CreateDiscussionModal } from '../CreateDiscussionModal';

async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

async function renderOpen(props = {}) {
  let utils;
  await act(async () => {
    utils = render(<CreateDiscussionModal open onClose={() => {}} onCreated={() => {}} {...props} />);
  });
  await flush();
  // round367 — the card opens folded behind the מתבנית/מזדמן toggle; reveal the
  // ADHOC body so the form fields exist (create mode only — duplicate opens revealed).
  if (!props.editDiscussion && !props.duplicateFrom) {
    await act(async () => { fireEvent.click(screen.getByRole('tab', { name: 'דיון מזדמן' })); });
  }
  return utils;
}

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('CreateDiscussionModal — external participants label (round278)', () => {
  it('labels the external field "משתתפים חיצוניים" even when the mapped column title is "משתתפים"', async () => {
    await renderOpen();
    // The exact string the owner wanted must be present in the DOM.
    expect(screen.getByText('משתתפים חיצוניים')).toBeTruthy();
  });

  it('does NOT show the external field under the bare "משתתפים" label', async () => {
    await renderOpen();
    // "משתתפים" (regular participants field) exists, but there must be no field
    // whose label is EXACTLY "משתתפים" standing in for the external one — i.e.
    // the external label is distinct. Both labels coexist and differ.
    const labels = screen.getAllByText(/משתתפים/);
    const texts = labels.map((n) => n.textContent.trim());
    expect(texts).toContain('משתתפים חיצוניים');
    expect(texts).toContain('משתתפים'); // the regular participants field, distinct
  });
});
