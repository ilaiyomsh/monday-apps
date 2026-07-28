import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mutable mode flag: byType=true appends the "לפי דיון מקור" group option.
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
// STABLE references — the component has effects that depend on these objects/
// arrays (the by-type bridge), so fresh literals per call would loop forever.
const SO = vi.hoisted(() => ({
  disc: { labelById: { t1: 'תכנון' }, loading: false },
  taskType: { options: [{ id: 'tt1', label: 'תכנון' }], loading: false },
  status: {
    options: [{ id: 's1', label: 'בעבודה', color: '#fdab3d' }],
    labelById: { s1: 'בעבודה' }, colorById: { s1: '#fdab3d' }, orderById: { s1: 0 },
  },
}));
vi.mock('@generated/hooks/useStatusOptions', () => ({
  // The default (status) options drive grouping/coloring.
  useStatusOptions: () => SO.status,
}));
// taskTypeID is a DROPDOWN column now — the by-type bridge reads its options here.
// Its label text matches the discussion's type text so the bridge resolves.
vi.mock('@generated/hooks/useDropdownOptions', () => ({
  useDropdownOptions: () => ({ ...SO.taskType, labels: SO.taskType.options.map((o) => o.label) }),
}));
vi.mock('@generated/components/TaskTable', () => ({
  TaskTable: ({ tasks }) => <div data-testid="table">{(tasks || []).map((t) => <div key={t.id}>{t.name}</div>)}</div>,
}));

// monday API layer / board-config — used only by the loaders; return inert data.
vi.mock('../../../utils/mondayApi/monday-client.js', () => ({
  api: vi.fn(async () => ({ items: [{ column_values: [{ linked_items: [] }] }] })),
  parseValue: () => null,
  cvSelection: () => '',
  monday: { execute: () => {} },
}));
vi.mock('../../../utils/mondayApi/board-config-store.js', () => ({
  getColumns: () => ({}),
}));
const tasksResult = vi.hoisted(() => ({
  items: [
    { id: '1', name: 'הנחיה א', statusID: 's1', responsibilityID: [], discussionLinkID: { linkedItems: [] } },
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

// round224 — the group builder is ONE flat option list now ("קבץ לפי"): opening
// the sheet exposes the options directly (no Column segment, no order picker).
async function openGroupOptions() {
  fireEvent.click(await screen.findByLabelText('קבץ לפי'));
}

describe('PreviousTasksTab — group-by builder (smoke)', () => {
  beforeEach(() => { cfg.byType = true; vp.mobile = true; });

  it('byType=true (mobile): group options include לפי דיון מקור', async () => {
    cfg.byType = true;
    render(<PreviousTasksTab discussion={DISCUSSION} />);
    await openGroupOptions();
    expect(screen.getByText('דיון מקור')).toBeTruthy();
  });

  it('byType=true (mobile): options list status/person', async () => {
    cfg.byType = true;
    render(<PreviousTasksTab discussion={DISCUSSION} />);
    await openGroupOptions();
    expect(screen.getByText('אחראי')).toBeTruthy();
  });

  it('byType=true (mobile): picking לפי אחראי regroups by person (unassigned header appears)', async () => {
    cfg.byType = true;
    render(<PreviousTasksTab discussion={DISCUSSION} />);
    // round274 — by-type defaults to "הפעם האחרונה" (a different fetch path); switch
    // to "כל הדיונים הקודמים" so the mocked type task set renders for the regroup.
    fireEvent.click(await screen.findByTitle(/החלפת טווח/));
    await openGroupOptions();
    fireEvent.click(screen.getByText('אחראי'));
    expect(await screen.findByText('לא הוקצה')).toBeTruthy();
  });
});
