import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// round148 — a new-discussion card opens stamped with the MOMENT it was opened:
// today's date + the current time, immediately editable. An explicit
// calendar-slot prefill still wins. (Mock harness mirrors
// createDiscussionModal.smoke.test.jsx.)

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
vi.mock('@generated/utils/mondayApi/board-config-store.js', () => ({
  getColumns: () => ({}),
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
      <div data-testid="date-picker">
        <input
          type="date"
          value={ymd}
          onChange={(e) => onChange(e.target.value ? new Date(`${e.target.value}T00:00:00`) : null)}
        />
      </div>
    );
  },
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
import { nowDateTimeInputs } from '@generated/utils/dateTime.js';

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
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 6, 17, 14, 37) });
  templatesValue.templates = [];
  templatesValue.participantTemplates = [];
});
afterEach(() => { vi.useRealTimers(); });

describe('nowDateTimeInputs', () => {
  it('returns the local date and zero-padded time of the given moment', () => {
    expect(nowDateTimeInputs?.(new Date(2026, 6, 17, 9, 5)) ?? {}).toEqual({ date: '2026-07-17', time: '09:05' });
  });
});

describe('CreateDiscussionModal — default date/time = now (round148)', () => {
  it('a plain create opens with today + the current time already set', async () => {
    await renderOpen();
    const date = document.querySelector('input[type="date"]');
    expect(date?.value).toBe('2026-07-17');
    expect(screen.getByText('14:37')).toBeTruthy();
  });

  it('a calendar-slot prefill still wins over "now"', async () => {
    await renderOpen({ prefill: { date: '2026-07-20', time: '10:00' } });
    const date = document.querySelector('input[type="date"]');
    expect(date?.value).toBe('2026-07-20');
    expect(screen.getByText('10:00')).toBeTruthy();
    expect(screen.queryByText('14:37')).toBeNull();
  });

  it('duplicating a discussion also opens stamped with now (was: empty date)', async () => {
    await renderOpen({ duplicateFrom: { id: '5', name: 'מקור' } });
    const date = document.querySelector('input[type="date"]');
    expect(date?.value).toBe('2026-07-17');
    expect(screen.getByText('14:37')).toBeTruthy();
  });
});
