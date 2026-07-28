import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/*
 * round306 PR review — the אפקטיביות drill-down renders the SHARED TaskTable, so
 * it must obey the same two rules as the משימות tab it borrows that table from:
 *   B) per-task capabilities — `canTask` comes from DiscussionCard bound to this
 *      discussion. Without it the table fell back to its allow-all default, so a
 *      viewer got a live inline picker for אחראי/שותפים, and a bulk edit fanned
 *      out to rows the user may not touch.
 *   C) column visibility — hiding a column in the משימות tab hides it here too
 *      (both tables already share widths + order under tableId 'tasks').
 * The table itself is mocked: what is under test is the CONTRACT this view hands
 * it, plus the permission filtering of the bulk-edit / delete paths.
 */

const { tableProps, savedView } = vi.hoisted(() => ({
  tableProps: { last: null },
  savedView: { value: null },
}));

vi.mock('@generated/components/TaskTable', () => ({
  TaskTable: (props) => {
    tableProps.last = props;
    return <div data-testid="task-table" />;
  },
}));
vi.mock('@generated/hooks/useStatusOptions', () => ({
  useStatusOptions: () => ({
    options: [{ id: 1, label: 'בתהליך', color: '#123456' }],
    labelById: { 1: 'בתהליך' },
    doneId: null,
  }),
}));
vi.mock('../../../contexts/SettingsContext.jsx', () => ({
  useSettings: () => ({ settings: {} }),
}));
vi.mock('@generated/hooks/useSavedViews.js', () => ({
  useSavedViews: () => ({ view: savedView.value, canSave: false, saveView: vi.fn() }),
}));
vi.mock('@api/board-config-store.js', () => ({ getColumns: () => ({}) }));
vi.mock('@generated/components/SelectionActionBar', () => ({
  SelectionActionBar: ({ children }) => <div>{children}</div>,
}));
// recharts needs layout jsdom doesn't provide. The Bar stub is a real button that
// forwards the click payload, which is how a drill-down is opened in the product.
vi.mock('recharts', () => {
  const Stub = ({ children }) => <div>{children}</div>;
  const Bar = ({ onClick, children }) => (
    <>
      <button type="button" data-testid="bar" onClick={() => onClick?.({ payload: { key: '1', name: 'בתהליך' } })}>
        bar
      </button>
      {children}
    </>
  );
  return {
    ResponsiveContainer: Stub, BarChart: Stub, Bar,
    XAxis: Stub, YAxis: Stub, CartesianGrid: Stub, Cell: () => null, Tooltip: Stub,
  };
});

import { EffectivenessTab } from '../EffectivenessTab.jsx';

const TASKS = [
  { id: '1', name: 'משימה א', statusID: 1, responsibilityID: [{ id: 'u1', name: 'דנה' }], partnersID: [] },
  { id: '2', name: 'משימה ב', statusID: 1, responsibilityID: [{ id: 'u2', name: 'יוסי' }], partnersID: [] },
];

const makeData = (over = {}) => ({
  items: TASKS,
  loading: false,
  updateTaskStatus: vi.fn(),
  updateTaskPriority: vi.fn(),
  updateTaskAssignee: vi.fn(),
  updateTaskPartners: vi.fn(),
  updateTaskDeadline: vi.fn(),
  softDeleteTasks: vi.fn(() => ({ undo: vi.fn() })),
  ...over,
});

// Render, then open the drill-down by clicking the (stubbed) status bar.
const renderDrillDown = (props = {}, data = makeData()) => {
  const utils = render(<EffectivenessTab data={data} {...props} />);
  fireEvent.click(screen.getAllByTestId('bar')[0]);
  return utils;
};

beforeEach(() => {
  vi.clearAllMocks();
  tableProps.last = null;
  savedView.value = null;
  // jsdom has no scrollIntoView; the view scrolls to the drill-down on select.
  Element.prototype.scrollIntoView = vi.fn();
});

describe('per-task capabilities reach the drill-down table', () => {
  it('passes the caller\'s canTask straight through (not the allow-all default)', () => {
    const canTask = vi.fn(() => true);
    renderDrillDown({ canTask });
    expect(screen.getByTestId('task-table')).toBeTruthy();
    expect(tableProps.last.canTask).toBe(canTask);
  });

  it('hides the row checkboxes when no shown row grants any edit/delete capability', () => {
    renderDrillDown({ canTask: () => false });
    expect(tableProps.last.selectable).toBe(false);
  });

  it('keeps the checkboxes when at least one capability passes', () => {
    renderDrillDown({ canTask: (cap) => cap === 'editTaskPartners' });
    expect(tableProps.last.selectable).toBe(true);
  });
});

describe('bulk edits apply ONLY to the rows the capability allows', () => {
  // Select both rows, then edit one of them: the fan-out must skip the denied row.
  const selectBoth = () => {
    act(() => tableProps.last.onToggleSelectAll(true));
  };

  it('שותפים: a mixed selection writes only to the permitted row', async () => {
    const data = makeData();
    renderDrillDown({ canTask: (cap, task) => cap === 'editTaskPartners' && task?.id === '1' }, data);
    selectBoth();
    await tableProps.last.onPartnersChange('1', [{ id: 'u9' }]);
    expect(data.updateTaskPartners).toHaveBeenCalledTimes(1);
    expect(data.updateTaskPartners).toHaveBeenCalledWith('1', [{ id: 'u9' }]);
  });

  it('אחראי: the batch endpoint receives the permitted subset only', async () => {
    const updateTasksAssigneeBatch = vi.fn();
    const data = makeData({ updateTasksAssigneeBatch });
    renderDrillDown({ canTask: (cap, task) => cap === 'editTaskAssignee' && task?.id === '2' }, data);
    selectBoth();
    await tableProps.last.onAssigneeChange('2', [{ id: 'u9' }]);
    // one permitted row → single write, no batch call
    expect(updateTasksAssigneeBatch).not.toHaveBeenCalled();
    expect(data.updateTaskAssignee).toHaveBeenCalledWith('2', [{ id: 'u9' }]);
  });

  it('a fully denied edit writes nothing at all', async () => {
    const data = makeData();
    renderDrillDown({ canTask: () => false }, data);
    await tableProps.last.onStatusChange('1', 1);
    expect(data.updateTaskStatus).not.toHaveBeenCalled();
  });

  it('deletion is limited to the rows deleteTask allows', () => {
    const data = makeData();
    renderDrillDown({ canTask: (cap, task) => cap === 'deleteTask' && task?.id === '2' }, data);
    act(() => tableProps.last.onToggleSelectAll(true));
    fireEvent.click(screen.getByText('מחיקה'));
    expect(data.softDeleteTasks).toHaveBeenCalledWith(['2']);
  });

  it('the delete button is disabled when nothing selected may be deleted', () => {
    const data = makeData();
    renderDrillDown({ canTask: (cap) => cap === 'editTaskStatus' }, data);
    act(() => tableProps.last.onToggleSelectAll(true));
    fireEvent.click(screen.getByText('מחיקה'));
    expect(data.softDeleteTasks).not.toHaveBeenCalled();
  });
});

describe('column visibility is inherited from the משימות tab saved view', () => {
  it('forwards its hiddenColumns to the table (so שותפים hides in both)', () => {
    savedView.value = { hiddenColumns: ['partners', 'deadline'] };
    renderDrillDown();
    expect([...tableProps.last.hiddenColumns]).toEqual(['partners', 'deadline']);
  });

  it('is an EMPTY set when nothing was saved (no column hidden by accident)', () => {
    renderDrillDown();
    expect(tableProps.last.hiddenColumns instanceof Set).toBe(true);
    expect(tableProps.last.hiddenColumns.size).toBe(0);
  });

  it('ignores a malformed saved value instead of throwing', () => {
    savedView.value = { hiddenColumns: 'partners' };
    renderDrillDown();
    expect(tableProps.last.hiddenColumns.size).toBe(0);
  });
});
