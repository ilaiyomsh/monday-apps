import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/*
 * round305 → round306 (owner request) — the personal tasks table carries the SAME
 * two PEOPLE columns as the discussion tasks table:
 *   · אחראי (responsibilityID)
 *   · שותפים (partnersID)
 * Both render in EVERY scope (round306 dropped round305's led-scope-only gate),
 * both only when their alias is mapped, both inline-editable through the same
 * PersonPicker the discussion table uses — gated per row by their own capability
 * (editTaskAssignee / editTaskPartners) — and read-only avatars otherwise.
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
// The picker is the EDIT affordance; the list is the read-only rendering. Both are
// the SAME components the discussion tasks table uses — that parity is the point.
vi.mock('@generated/components/PersonPicker', () => ({
  PersonPicker: ({ selected, onChange, single }) => (
    <button
      type="button"
      data-testid={single ? 'person-picker-single' : 'person-picker'}
      onClick={() => onChange([{ id: 'u9', name: 'נבחר חדש' }])}
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

const renderTable = (props = {}) => render(<MyTasksTable tasks={[TASK]} {...props} />);

beforeEach(() => {
  vi.clearAllMocks();
  columnsMock.value = {
    deadlineID: { id: 'date_x' },
    responsibilityID: { id: 'people_r' },
    partnersID: { id: 'people_p' },
  };
});

describe('both people columns render in every scope (round306)', () => {
  it('shows the אחראי and שותפים headers whenever their aliases are mapped', () => {
    renderTable();
    expect(screen.getByText('אחראי')).toBeInTheDocument();
    expect(screen.getByText('שותפים')).toBeInTheDocument();
  });

  it('drops each column when its alias is unmapped', () => {
    columnsMock.value = { deadlineID: { id: 'date_x' } };
    renderTable();
    expect(screen.queryByText('אחראי')).toBeNull();
    expect(screen.queryByText('שותפים')).toBeNull();
  });
});

describe('שותפים — inline edit gated by editTaskPartners', () => {
  it('renders the multi PersonPicker and reports the picked people', () => {
    const onPartnersChange = vi.fn();
    renderTable({ onPartnersChange, canTask: (cap) => cap === 'editTaskPartners' });
    const picker = screen.getByTestId('person-picker');
    expect(picker.textContent).toContain('יוסי');
    picker.click();
    expect(onPartnersChange).toHaveBeenCalledWith('1', [{ id: 'u9', name: 'נבחר חדש' }]);
  });

  it('degrades to read-only avatars when the gate DENIES', () => {
    renderTable({ onPartnersChange: () => {}, canTask: () => false });
    expect(screen.queryByTestId('person-picker')).toBeNull();
    expect(screen.getByText('יוסי')).toBeInTheDocument();
  });
});

describe('אחראי — inline edit gated by editTaskAssignee, single-select like the discussion table', () => {
  it('renders a SINGLE-select PersonPicker (one אחראי per task) and reports the pick', () => {
    const onAssigneeChange = vi.fn();
    renderTable({ onAssigneeChange, canTask: (cap) => cap === 'editTaskAssignee' });
    const picker = screen.getByTestId('person-picker-single');
    expect(picker.textContent).toContain('דנה');
    picker.click();
    expect(onAssigneeChange).toHaveBeenCalledWith('1', [{ id: 'u9', name: 'נבחר חדש' }]);
  });

  it('degrades to read-only avatars when the gate DENIES', () => {
    renderTable({ onAssigneeChange: () => {}, canTask: () => false });
    expect(screen.queryByTestId('person-picker-single')).toBeNull();
    expect(screen.getByText('דנה')).toBeInTheDocument();
  });

  it('each column answers to its OWN capability (partners denied ⇏ assignee denied)', () => {
    renderTable({
      onAssigneeChange: () => {},
      onPartnersChange: () => {},
      canTask: (cap) => cap === 'editTaskAssignee',
    });
    expect(screen.getByTestId('person-picker-single')).toBeInTheDocument(); // אחראי editable
    expect(screen.queryByTestId('person-picker')).toBeNull(); // שותפים read-only
  });
});
