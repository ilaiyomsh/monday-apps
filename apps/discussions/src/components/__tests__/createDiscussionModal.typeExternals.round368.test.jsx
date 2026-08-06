import React from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/*
 * round368 §1 (owner bug report) — a discussion TYPE whose template carries
 * משתתפים חיצוניים must inject them into the create card the moment that
 * template is picked, exactly like the template's lead/coordinator/participants.
 * The owner saved externals on a type template and saw nothing appear in the
 * card; this test drives the real pick flow with fake data.
 */

const mondayMock = vi.hoisted(() => ({ value: { currentUser: { id: '1', name: 'בדיקה' }, context: null } }));
vi.mock('@generated/contexts/MondayContext.jsx', async () => {
  const R = await import('react');
  return { useMondayContext: () => mondayMock.value, MondayContext: R.createContext(mondayMock.value) };
});

vi.mock('@generated/contexts/SettingsContext.jsx', () => ({
  useSettings: () => ({
    settings: { preferences: {} },
    permissions: { enabled: true, version: 1, roles: {} },
    updateSettings: async () => {},
  }),
}));

const templatesValue = vi.hoisted(() => ({
  templates: [], participantTemplates: [], typeTemplates: [],
  typeColor: () => null,
  assignRandomTypeColor: vi.fn(),
}));
vi.mock('@generated/contexts/TemplatesContext.jsx', () => ({ useTemplates: () => templatesValue }));

vi.mock('@generated/hooks/useDropdownOptions.js', () => ({
  useDropdownOptions: () => ({ options: [{ id: 1, label: 'ישיבת צוות', index: 0 }], loading: false }),
  addDropdownLabel: vi.fn(async () => true),
}));

vi.mock('@generated/utils/mondayApi/hooks/use-users.js', () => ({ useUsers: () => ({ users: [] }) }));
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

// The external-participants column IS mapped, so the field renders.
vi.mock('@generated/utils/mondayApi/board-config-store.js', () => ({
  getColumns: () => ({
    externalParticipantsID: { id: 'long_text_ext' },
    participantsID: { id: 'people_participants' },
  }),
  getBoardId: () => null,
}));

vi.mock('@generated/utils/mondayApi/peopleColumns.js', () => ({
  subscribe: () => () => {},
  getVersion: () => 0,
  getPeopleColumns: () => ({}),
  getPeopleColumnIds: () => [],
  getColumnTitle: (_board, alias) => (alias === 'discussionTypeID' ? 'סוג דיון' : 'משתתפים'),
  isColumnMapped: () => true,
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

async function openAndPickTemplate() {
  await act(async () => {
    render(<CreateDiscussionModal open onClose={() => {}} onCreated={() => {}} />);
  });
  await flush();
  // TEMPLATE mode is the default half; pick the template from the picker.
  await act(async () => { fireEvent.click(screen.getByText('בחרו תבנית דיון')); });
  await act(async () => { fireEvent.click(screen.getByText('ישיבת צוות')); });
  await flush();
}

beforeEach(() => {
  vi.clearAllMocks();
  templatesValue.templates = [];
  templatesValue.participantTemplates = [];
  templatesValue.typeTemplates = [];
});
afterEach(() => { vi.restoreAllMocks(); });

describe('round368 — a type template injects its external participants', () => {
  it('picking the template shows its externals as chips in the card', async () => {
    templatesValue.typeTemplates = [{
      id: 'tt1',
      discussionType: 'ישיבת צוות',
      topics: [{ name: 'נושא', points: ['נקודה'] }],
      lead: [], coordinator: [], participants: [],
      externalParticipants: ['רו"ח אבי שגב', 'יועץ חיצוני'],
    }];
    await openAndPickTemplate();
    expect(screen.getByText('רו"ח אבי שגב')).toBeTruthy();
    expect(screen.getByText('יועץ חיצוני')).toBeTruthy();
  });

  it('a template WITHOUT externals leaves the field empty (no crash, no ghost chips)', async () => {
    templatesValue.typeTemplates = [{
      id: 'tt2',
      discussionType: 'ישיבת צוות',
      topics: [{ name: 'נושא', points: [] }],
      lead: [], coordinator: [], participants: [],
      externalParticipants: [],
    }];
    await openAndPickTemplate();
    expect(screen.getByLabelText('הוספת משתתף חיצוני')).toBeTruthy();
    expect(screen.queryByText('רו"ח אבי שגב')).toBeNull();
  });

  it('a LEGACY template object with no externalParticipants key at all still applies cleanly', async () => {
    templatesValue.typeTemplates = [{
      id: 'tt3',
      discussionType: 'ישיבת צוות',
      topics: [{ name: 'נושא', points: [] }],
      lead: [], coordinator: [], participants: [],
    }];
    await openAndPickTemplate();
    expect(screen.getByLabelText('הוספת משתתף חיצוני')).toBeTruthy();
  });
});
