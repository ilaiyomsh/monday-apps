/* TEMPORARY INVESTIGATION TEST — delete after run. Verifies whether editing a
 * discussion and CHANGING its previous discussion lands in the update payload. */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

const templatesValue = vi.hoisted(() => ({
  templates: [], participantTemplates: [], typeTemplates: [],
  typeColor: () => '#ccc', assignRandomTypeColor: async () => {},
}));
vi.mock('@generated/contexts/TemplatesContext.jsx', () => ({
  useTemplates: () => templatesValue,
}));

vi.mock('@generated/utils/mondayApi/hooks/use-users.js', () => ({
  useUsers: () => ({ users: [] }),
}));

vi.mock('@generated/hooks/useDropdownOptions.js', () => ({
  useDropdownOptions: () => ({ options: [], loading: false }),
  addDropdownLabel: vi.fn(),
}));

const captured = vi.hoisted(() => ({ updatePayload: null, updateId: null }));
vi.mock('@api/BoardSDK.js', () => {
  const fullRecord = () => {
    const d = new Date(2026, 6, 1, 9, 0);
    d.hasTime = true;
    return {
      id: '100', name: 'דיון א', discussionDateID: d,
      discussionLeadID: [], discussionCoordinatorID: [], participantsID: [],
      discussionTypeID: null,
    };
  };
  class Board {
    items() { return this; }
    withColumns() { return this; }
    orderBy() { return this; }
    withPagination() { return this; }
    async execute() {
      return {
        items: [
          { id: '201', name: 'דיון ב', discussionDateID: null },
          { id: '202', name: 'דיון ג', discussionDateID: null },
        ],
        cursor: null,
      };
    }
    item(id) {
      return {
        create: () => ({ execute: async () => ({ id: '99' }) }),
        update: (p) => {
          captured.updatePayload = p;
          captured.updateId = id;
          return { execute: async () => ({ id }) };
        },
      };
    }
    async itemById() { return fullRecord(); }
  }
  return { דיונים1Board: Board };
});

vi.mock('@generated/utils/mondayApi/monday-client.js', () => ({
  api: vi.fn(async () => ({ items: [{ column_values: [{ marker: 'prev-cv' }] }] })),
  parseValue: vi.fn(() => ({ linkedItems: [{ id: '201', name: 'דיון ב' }], ids: ['201'], text: 'דיון ב' })),
  cvSelection: () => 'id',
}));

vi.mock('@generated/utils/mondayApi/board-config-store.js', () => ({
  getColumns: () => ({ previousDiscussionID: { id: 'connect_1', type: 'board_relation' } }),
  getBoardId: () => null,
}));

vi.mock('@generated/utils/templates.js', () => ({
  createTopicsFromTemplate: vi.fn(),
  countPoints: () => 0,
  readDiscussionTopicsAsTemplate: vi.fn(async () => ({ topics: [] })),
}));

vi.mock('@generated/components/DatePickerPopover', () => ({
  DatePickerPopover: ({ value, onChange }) => {
    const ymd = value
      ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
      : '';
    return (
      <input
        data-testid="date-input"
        type="date"
        value={ymd}
        onChange={(e) => onChange(e.target.value ? new Date(`${e.target.value}T00:00:00`) : null)}
      />
    );
  },
}));

vi.mock('@generated/components/PersonPicker', () => ({
  PersonPicker: () => <div data-testid="person-picker" />,
}));

import { CreateDiscussionModal } from '../CreateDiscussionModal';

async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
}

beforeEach(() => { captured.updatePayload = null; captured.updateId = null; });
afterEach(() => { vi.restoreAllMocks(); });

describe('edit mode: changing previous discussion', () => {
  it('includes the NEW previousDiscussionID in the update payload', async () => {
    await act(async () => {
      render(
        <CreateDiscussionModal
          open
          onClose={() => {}}
          onCreated={() => {}}
          editDiscussion={{ id: '100', name: 'דיון א' }}
        />
      );
    });
    await flush();

    // The trigger should reflect the CURRENT link (id 201 -> 'דיון ב')
    const trigger = screen.getByText('דיון ב');
    expect(trigger).toBeTruthy();

    // Open the previous-discussion dropdown and pick 'דיון ג' (id 202)
    fireEvent.click(trigger);
    const option = await screen.findByRole('option', { name: 'דיון ג' });
    fireEvent.click(option);

    // Submit ("שמור שינויים")
    const submit = screen.getByText('שמור שינויים').closest('button');
    expect(submit.getAttribute('aria-disabled')).not.toBe('true');
    await act(async () => { fireEvent.click(submit); });
    await flush();

    // What did the update actually receive?
    // eslint-disable-next-line no-console
    console.log('CAPTURED UPDATE id=', captured.updateId, 'payload=', JSON.stringify(captured.updatePayload));
    expect(captured.updateId).toBe('100');
    expect(captured.updatePayload?.previousDiscussionID).toEqual({ linkedItems: [{ id: '202' }] });
  });
});
