import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/*
 * round305 (owner request) — the personal tasks table gains two PEOPLE columns:
 *   · שותפים (partnersID) — in BOTH scopes, inline-editable when the permission
 *     gate passes (owners · discussion lead/creator/coordinator · task creator ·
 *     task responsible), read-only avatars otherwise;
 *   · אחראי (responsibilityID) — read-only, and ONLY in the "בדיונים שהובלתי"
 *     scope (in the default scope every row is the current user's own).
 * Both render only when their alias is mapped.
 */

const { columnsMock } = vi.hoisted(() => ({
  columnsMock: {
    value: {
      deadlineID: { id: 'date_x' },
      responsibilityID: { id: 'people_r' },
      partnersID: { id: 'people_p' },
    },
  },
}));
vi.mock('../../../utils/mondayApi/board-config-store.js', () => ({
  getColumns: () => columnsMock.value,
}));
vi.mock('../../../hooks/useColumnWidths.js', () => ({
  useColumnWidths: () => ({ gridTemplate: 'repeat(6, 1fr)', startResize: () => {} }),
}));
vi.mock('../../../hooks/useViewport.js', () => ({
  useViewport: () => ({ isMobile: false, isTablet: false, isDesktop: true }),
}));
// Column order follows the table's own default def list (name first).
vi.mock('../../../hooks/useColumnOrder.js', () => ({
  useColumnOrder: (id, keys) => ({ order: keys, reorder: () => {} }),
}));
vi.mock('@generated/hooks/useStatusOptions', () => ({
  useStatusOptions: () => ({ options: [], labelById: {}, colorById: {}, orderById: {} }),
}));
vi.mock('@api/monday-client.js', () => ({ monday: { execute: vi.fn() } }));
vi.mock('@generated/components/DatePickerPopover', () => ({
  DatePickerPopover: () => <button type="button" data-testid="date-picker" />,
}));
// The picker is the EDIT affordance; the list is the read-only rendering.
vi.mock('@generated/components/PersonPicker', () => ({
  PersonPicker: ({ selected, onChange }) => (
    <button
      type="button"
      data-testid="person-picker"
      onClick={() => onChange([{ id: 'u9', name: 'שותף חדש' }])}
    >
      {`picker:${(selected || []).map((p) => p.name).join(',')}`}
    </button>
  ),
}));
vi.mock('@generated/components/PersonAvatar', () => ({
  PersonList: ({ people }) => (
    <span data-testid="person-list">
      {(people || []).length ? people.map((p) => p.name).join(',') : 'לא הוקצה'}
    </span>
  ),
}));

import { MyTasksTable } from '../MyTasksTable.jsx';

const TASK = {
  id: '1',
  name: 'משימה',
  statusID: 0,
  responsibilityID: [{ id: 'u1', name: 'דנה' }],
  partnersID: [{ id: 'u2', name: 'יוסי' }],
};

const renderTable = (props = {}) => render(
  <MyTasksTable tasks={[TASK]} onPartnersChange={() => {}} {...props} />
);

beforeEach(() => {
  vi.clearAllMocks();
  columnsMock.value = {
    deadlineID: { id: 'date_x' },
    responsibilityID: { id: 'people_r' },
    partnersID: { id: 'people_p' },
  };
});

describe('שותפים column', () => {
  it('renders in the DEFAULT scope with its header', () => {
    renderTable();
    expect(screen.getByText('שותפים')).toBeInTheDocument();
  });

  it('is inline-editable when the gate allows editTaskPartners, and reports the picked people', () => {
    const onPartnersChange = vi.fn();
    renderTable({ onPartnersChange, canTask: (cap) => cap === 'editTaskPartners' });
    const picker = screen.getByTestId('person-picker');
    expect(picker.textContent).toContain('יוסי');
    picker.click();
    expect(onPartnersChange).toHaveBeenCalledWith('1', [{ id: 'u9', name: 'שותף חדש' }]);
  });

  it('degrades to read-only when the gate DENIES editTaskPartners', () => {
    renderTable({ onPartnersChange: () => {}, canTask: () => false });
    expect(screen.queryByTestId('person-picker')).toBeNull();
    expect(screen.getByText('יוסי')).toBeInTheDocument();
  });

  it('is absent when the partnersID alias is not mapped', () => {
    columnsMock.value = { deadlineID: { id: 'date_x' }, responsibilityID: { id: 'people_r' } };
    renderTable();
    expect(screen.queryByText('שותפים')).toBeNull();
    expect(screen.queryByTestId('person-picker')).toBeNull();
  });
});

describe('אחראי column — the "בדיונים שהובלתי" scope only', () => {
  it('is HIDDEN in the default scope', () => {
    renderTable();
    expect(screen.queryByText('אחראי')).toBeNull();
  });

  it('shows read-only responsibility people when showAssignee is set', () => {
    renderTable({ showAssignee: true });
    expect(screen.getByText('אחראי')).toBeInTheDocument();
    expect(screen.getByText('דנה')).toBeInTheDocument();
    // read-only: the אחראי cell never renders a picker (reassigning stays in the
    // discussion's own tasks table).
    expect(screen.getAllByTestId('person-list').some((el) => el.textContent === 'דנה')).toBe(true);
  });

  it('stays hidden in the led scope when responsibilityID is unmapped', () => {
    columnsMock.value = { deadlineID: { id: 'date_x' }, partnersID: { id: 'people_p' } };
    renderTable({ showAssignee: true });
    expect(screen.queryByText('אחראי')).toBeNull();
  });
});
