import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- Mock the heavy data layer so the modal mounts in jsdom ---------------

// usePermission reads MondayContext via useContext (soft), so the mock must
// export a real context (not just the hook) or useContext throws.
const mondayMock = vi.hoisted(() => ({ value: { currentUser: { id: '1', name: 'בדיקה' }, context: null } }));
vi.mock('@generated/contexts/MondayContext.jsx', async () => {
  const R = await import('react');
  return {
    useMondayContext: () => mondayMock.value,
    MondayContext: R.createContext(mondayMock.value),
  };
});

// usePermission also calls useSettings — return an always-on empty-roles blob so
// system caps resolve via CAPABILITY_DEFAULTS (addDiscussionTypes → owner-only).
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

// BoardSDK — the modal news up a board on open to load previous-discussion
// options. Return an empty list so loadDiscussions resolves cleanly.
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

vi.mock('@generated/utils/mondayApi/board-config-store.js', () => ({
  getColumns: () => ({}),
  // peopleColumns.ensurePeopleColumns reads this; null ⇒ it no-ops (no board id).
  getBoardId: () => null,
}));

vi.mock('@generated/utils/templates.js', () => ({
  createTopicsFromTemplate: vi.fn(),
  countPoints: () => 0,
  readDiscussionTopicsAsTemplate: vi.fn(async () => ({ topics: [] })),
}));

// DatePickerPopover wraps the @vibe DatePicker in a Dialog that can't open in
// jsdom — stub it with a controllable native input + a conditional clear so date
// selection/clear can still be driven in tests.
vi.mock('@generated/components/DatePickerPopover', () => ({
  DatePickerPopover: ({ value, onChange }) => {
    const ymd = value
      ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
      : '';
    return (
      <div data-testid="date-picker">
        <input
          type="date"
          value={ymd}
          onChange={(e) => onChange(e.target.value ? new Date(`${e.target.value}T00:00:00`) : null)}
        />
        {value && (
          <button type="button" aria-label="ניקוי תאריך" onClick={() => onChange(null)}>clear</button>
        )}
      </div>
    );
  },
}));

// PersonPicker is portal/store heavy — stub it with a controllable shim.
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
  return utils;
}

beforeEach(() => {
  vi.clearAllMocks();
  templatesValue.templates = [];
  templatesValue.participantTemplates = [];
});

afterEach(() => { vi.restoreAllMocks(); });

describe('CreateDiscussionModal', () => {
  it('renders the title input and date field when open', async () => {
    await renderOpen();
    expect(screen.getByLabelText('שם הדיון')).toBeTruthy();
    // native date input
    const date = document.querySelector('input[type="date"]');
    expect(date).toBeTruthy();
  });

  // round182 — the standalone "בחר תבנית" topic-template dropdown was REMOVED in
  // round147: templates are now TYPE-driven (picking a discussion type auto-applies
  // its topic template; there is no manual template picker anymore). The old test
  // that guarded that dropdown's "ללא תבנית" option is therefore retired — the
  // feature it targeted no longer exists. The previous-discussion dropdown below
  // still exists and keeps its own "no explicit none option" guard.

  it('does not render a "ללא דיון קודם" option in the previous-discussion dropdown', async () => {
    await renderOpen();
    expect(screen.queryByText('ללא דיון קודם')).toBeNull();
    // placeholder shown for unset previous discussion
    expect(screen.getByText('בחר דיון קודם')).toBeTruthy();
  });

  it('does not render a "ללא סוג" option and shows the placeholder when type unset', async () => {
    await renderOpen();
    expect(screen.queryByText('ללא סוג')).toBeNull();
    expect(screen.getByText('בחר סוג דיון')).toBeTruthy();
  });

  it('shows a clear (X) button on the title only when a name is present, and clears it', async () => {
    // A new discussion is prefilled with the default name, so the clear shows.
    await renderOpen();
    const input = screen.getByLabelText('שם הדיון');
    expect(input.value).toBeTruthy();
    const clear = screen.getByLabelText('ניקוי שם');
    fireEvent.click(clear);
    expect(input.value).toBe('');
    // empty -> no clear
    expect(screen.queryByLabelText('ניקוי שם')).toBeNull();
    // typing brings it back
    fireEvent.change(input, { target: { value: 'דיון' } });
    expect(screen.getByLabelText('ניקוי שם')).toBeTruthy();
  });

  it('shows a clear button on the date field (preset since round148) and clears it', async () => {
    await renderOpen();
    const date = document.querySelector('input[type="date"]');
    // round148: the card opens with today's date already set, so the clear
    // affordance is present from the start.
    expect(date.value).not.toBe('');
    const clear = screen.getByLabelText('ניקוי תאריך');
    fireEvent.click(clear);
    expect(date.value).toBe('');
    expect(screen.queryByLabelText('ניקוי תאריך')).toBeNull();
  });

  it('selecting a date updates the field (via the shared DatePickerPopover)', async () => {
    await renderOpen();
    const date = document.querySelector('input[type="date"]');
    expect(date).toBeTruthy();
    fireEvent.change(date, { target: { value: '2026-07-01' } });
    expect(date.value).toBe('2026-07-01');
  });

  it('hides the "+ add type" affordance for a non-owner without the permission', async () => {
    await renderOpen();
    fireEvent.click(screen.getByText('בחר סוג דיון'));
    expect(screen.queryByText('+ הוסף סוג דיון חדש')).toBeNull();
  });

  it('shows the "+ add type" affordance for an owner (canManageSettings)', async () => {
    await renderOpen({ canManageSettings: true });
    fireEvent.click(screen.getByText('בחר סוג דיון'));
    expect(screen.getByText('+ הוסף סוג דיון חדש')).toBeTruthy();
  });

  it('disables the submit button when the (preset) date is cleared', async () => {
    await renderOpen();
    const submit = screen.getByText('צור דיון').closest('button');
    // round148: name, date AND time are all preset on open -> submit enabled.
    // @vibe/core Button reflects disabled via aria-disabled (not the DOM attr).
    expect(submit.getAttribute('aria-disabled')).toBe('false');
    // clearing the required date disables it again.
    fireEvent.click(screen.getByLabelText('ניקוי תאריך'));
    expect(submit.getAttribute('aria-disabled')).toBe('true');
  });
});
