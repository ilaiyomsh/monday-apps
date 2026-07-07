import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Point 10: a Filter pill (like My Tasks) on the "הנחיות קודמות" tab, filtering
// status + deadline + person CLIENT-SIDE over the loaded tasks.
const cfg = vi.hoisted(() => ({ byType: true }));
const vp = vi.hoisted(() => ({ mobile: true }));

vi.mock('@generated/hooks/useViewport.js', () => ({
  useViewport: () => ({ isMobile: vp.mobile, isTablet: false, isDesktop: !vp.mobile }),
}));
vi.mock('@generated/contexts/SettingsContext.jsx', () => ({
  useSettings: () => ({
    settings: { preferences: { previousTasksMode: cfg.byType ? 'discussionType' : 'linkedDiscussion' } },
  }),
}));
const SO = vi.hoisted(() => ({
  disc: { labelById: { t1: 'תכנון' }, loading: false },
  taskType: { options: [{ id: 'tt1', label: 'תכנון' }], loading: false },
  status: {
    options: [{ id: 's1', label: 'בעבודה', color: '#fdab3d' }],
    labelById: { s1: 'בעבודה' }, colorById: { s1: '#fdab3d' }, orderById: { s1: 0 },
  },
}));
vi.mock('@generated/hooks/useStatusOptions', () => ({
  useStatusOptions: () => SO.status,
}));
// taskTypeID is a DROPDOWN column now — the by-type bridge reads its options here.
vi.mock('@generated/hooks/useDropdownOptions', () => ({
  useDropdownOptions: () => ({ ...SO.taskType, labels: SO.taskType.options.map((o) => o.label) }),
}));
vi.mock('@generated/components/TaskTable', () => ({
  TaskTable: ({ tasks }) => <div data-testid="table">{(tasks || []).map((t) => <div key={t.id}>{t.name}</div>)}</div>,
}));
vi.mock('../../../utils/mondayApi/monday-client.js', () => ({
  api: vi.fn(async () => ({ items: [{ column_values: [{ linked_items: [] }] }] })),
  parseValue: () => null,
  cvSelection: () => '',
  monday: { execute: () => {} },
}));
vi.mock('../../../utils/mondayApi/board-config-store.js', () => ({ getColumns: () => ({}) }));
const tasksResult = vi.hoisted(() => ({
  items: [
    { id: '1', name: 'הנחיה של דנה', statusID: 's1', responsibilityID: [{ id: 1, name: 'דנה' }], deadlineID: null, discussionLinkID: { linkedItems: [] } },
    { id: '2', name: 'הנחיה של יוסי', statusID: 's1', responsibilityID: [{ id: 2, name: 'יוסי' }], deadlineID: null, discussionLinkID: { linkedItems: [] } },
  ],
}));
vi.mock('@api/BoardSDK.js', () => {
  class FakeBoard {
    items() { return this; }
    item() { return this; }
    where() { return this; }
    withColumns() { return this; }
    withPagination() { return this; }
    orderBy() { return this; }
    update() { return this; }
    async execute() { return tasksResult; }
  }
  return { משימות1Board: FakeBoard, דיונים1Board: FakeBoard };
});

import { PreviousTasksTab } from '../PreviousTasksTab.jsx';

// discussionTypeID is now the dropdown label TEXT (bridged to taskTypeID by text).
const DISCUSSION = { id: 'D1', name: 'דיון נוכחי', discussionTypeID: 'תכנון' };

describe('PreviousTasksTab — Filter pill (smoke)', () => {
  beforeEach(() => { cfg.byType = true; vp.mobile = true; });

  it('renders a Filter pill that opens the builder sheet EMPTY; "+ New filter" adds the status row', async () => {
    render(<PreviousTasksTab discussion={DISCUSSION} />);
    const pill = await screen.findByLabelText('Filter');
    fireEvent.click(pill);
    expect(screen.queryByText('Where')).toBeNull();      // empty default — no pre-seeded row
    expect(screen.getByText('No filters — showing all tasks')).toBeTruthy();
    fireEvent.click(screen.getByText('+ New filter'));   // adds the first (status) row
    expect(screen.getByText('Where')).toBeTruthy();
    expect(screen.getByText('סטטוס')).toBeTruthy();
  });

  it('offers status + deadline + person columns (no priority)', async () => {
    render(<PreviousTasksTab discussion={DISCUSSION} />);
    fireEvent.click(await screen.findByLabelText('Filter'));
    fireEvent.click(screen.getByText('+ New filter')); // empty default — add the first row
    // open the column picker (the row's column segment shows "סטטוס")
    fireEvent.click(screen.getByText('סטטוס'));
    expect(screen.getByText('אחראי')).toBeTruthy();   // person column available
    expect(screen.getByText('דד ליין')).toBeTruthy(); // deadline column available
    expect(screen.queryByText('עדיפות')).toBeNull();  // priority NOT offered
  });

  it('filtering by a person narrows the rendered tasks', async () => {
    render(<PreviousTasksTab discussion={DISCUSSION} />);
    expect(await screen.findByText('הנחיה של דנה')).toBeTruthy();
    expect(screen.getByText('הנחיה של יוסי')).toBeTruthy();

    fireEvent.click(await screen.findByLabelText('Filter'));
    fireEvent.click(screen.getByText('+ New filter')); // empty default — add the first row
    // retarget the row to the person column
    fireEvent.click(screen.getByText('סטטוס'));
    fireEvent.click(screen.getByText('אחראי'));
    // open the person value list (empty multi-segment shows "Choose values") and pick דנה
    fireEvent.click(screen.getByText('Choose values'));
    fireEvent.click(screen.getByText('דנה'));

    expect(screen.getByText('הנחיה של דנה')).toBeTruthy();
    expect(screen.queryByText('הנחיה של יוסי')).toBeNull();
  });
});
