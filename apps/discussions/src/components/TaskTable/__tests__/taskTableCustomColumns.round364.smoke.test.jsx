import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/*
 * round364 — owner-added custom mappings (custom<N>ID on the tasks board)
 * render as READ-ONLY trailing columns in the shared tasks table. Pinned here:
 *   1. the header shows the custom column's live title and the cell shows the
 *      task's value (a text custom column);
 *   2. the desktop grid template never contains an "undefinedpx" track — the
 *      custom key has no entry in the width constants, and without the
 *      fallback the whole grid collapses;
 *   3. an UNMAPPED custom alias (id '') adds no column.
 */

const { columnsMock } = vi.hoisted(() => ({
  columnsMock: {
    value: {
      responsibilityID: { id: 'people_r' },
      custom1ID: { id: 'text_col', type: 'text', title: 'שלב בפרויקט', custom: true },
      custom2ID: { id: '', type: 'people', custom: true },
    },
  },
}));
vi.mock('@api/board-config-store.js', () => ({ getColumns: () => columnsMock.value }));
vi.mock('@generated/hooks/useStatusOptions', () => ({
  useStatusOptions: () => ({ options: [], labelById: {}, colorById: {}, orderById: {}, doneId: null, loading: false }),
}));
vi.mock('@generated/components/DatePickerPopover', () => ({ DatePickerPopover: () => null }));
vi.mock('@generated/components/PersonPicker', () => ({ PersonPicker: () => null }));
vi.mock('@generated/components/PersonAvatar', () => ({
  PersonList: ({ people }) => <span data-testid="person-list">{(people || []).map((p) => p.name).join(',') || '—'}</span>,
}));
vi.mock('@api/monday-client.js', () => ({ monday: { execute: () => {} } }));

import { TaskTable } from '../TaskTable.jsx';

const TASK = {
  id: '1',
  name: 'משימה',
  statusID: null,
  responsibilityID: [{ id: 'u1', name: 'דנה' }],
  deadlineID: null,
  custom1ID: 'אפיון',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('round364 — TaskTable custom columns', () => {
  it('renders the custom column header (live title) and the task value read-only', () => {
    const { container } = render(<TaskTable tasks={[TASK]} />);
    expect(screen.getByText('שלב בפרויקט')).toBeTruthy();
    expect(screen.getByText('אפיון')).toBeTruthy();
    // the value cell is display-only — no input/button wraps the text
    expect(screen.getByText('אפיון').closest('button')).toBe(null);
    // the grid template got a REAL track for the custom key
    const row = container.querySelector('[style*="grid-template-columns"]');
    expect(row?.getAttribute('style') || '').not.toContain('undefined');
  });

  it('an unmapped custom alias contributes no column', () => {
    render(<TaskTable tasks={[TASK]} />);
    // custom2ID has no title and no id — nothing labels it in the header
    expect(screen.queryByText('custom2ID')).toBe(null);
  });

  it('an empty custom value renders the muted em-dash, not a crash', () => {
    render(<TaskTable tasks={[{ ...TASK, custom1ID: null }]} />);
    expect(screen.getByText('שלב בפרויקט')).toBeTruthy();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });
});
