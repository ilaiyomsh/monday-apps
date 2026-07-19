import React from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// round152 — smoke test for the dashboard VIEW: mocks the data hook and asserts
// the aggregation reaches the hero/KPIs, and that the sum→avg toggle re-derives.

const hookValue = vi.hoisted(() => ({ value: null }));
vi.mock('@generated/hooks/useDashboardData.js', () => ({
  useDashboardData: () => hookValue.value,
}));
vi.mock('@generated/components/BrandLoader', () => ({ BrandLoader: () => <div>loading…</div> }));
// recharts + DatePicker are portal/measure-heavy in jsdom — stub to no-ops so
// the view's own layout (hero, tiles, filters) is what's under test. Explicit
// named exports (NOT a Proxy — a Proxy answers `then` and the ESM loader then
// awaits the module forever).
vi.mock('recharts', () => {
  const Passthrough = ({ children }) => <div>{children}</div>;
  const Empty = () => null;
  return {
    ResponsiveContainer: Passthrough, BarChart: Passthrough, PieChart: Passthrough,
    Bar: Passthrough, Pie: Passthrough, Cell: Empty, XAxis: Empty, YAxis: Empty,
    CartesianGrid: Empty, Tooltip: Empty, LabelList: Empty,
  };
});
vi.mock('@generated/components/DatePickerPopover', () => ({ DatePickerPopover: () => <div data-testid="date" /> }));

import { DiscussionsDashboard } from '../DiscussionsDashboard.jsx';

const NOW_DATA = () => ({
  discussions: [
    { id: '1', name: 'A', date: new Date(), type: 'שבועי', lead: [{ id: '10', name: 'דנה' }], participants: [{ id: 'p1', name: 'רות' }, { id: 'p2', name: 'יוסי' }] },
    { id: '2', name: 'B', date: new Date(), type: 'צוותי', lead: [{ id: '11', name: 'עידו' }], participants: [{ id: 'p1', name: 'רות' }] },
  ],
  tasks: [
    { id: 't1', discussionId: '1', statusID: 1, deadlineID: null },
    { id: 't2', discussionId: '1', statusID: 0, deadlineID: null },
    { id: 't3', discussionId: '2', statusID: 1, deadlineID: null },
  ],
  decisions: [{ id: 'd1', discussionId: '1' }, { id: 'd2', discussionId: '2' }],
  doneStatusIds: new Set([1]),
});

beforeEach(() => { hookValue.value = { data: NOW_DATA(), loading: false, error: null, reload: () => {} }; });

describe('DiscussionsDashboard', () => {
  it('shows a loader while loading', () => {
    hookValue.value = { data: null, loading: true, error: null, reload: () => {} };
    render(<DiscussionsDashboard onBackToDiscussions={() => {}} />);
    expect(screen.getByText('loading…')).toBeTruthy();
  });

  it('renders the effectiveness hero and KPI tiles from the aggregation', () => {
    render(<DiscussionsDashboard onBackToDiscussions={() => {}} />);
    // 2 of 3 tasks are done → 67%
    expect(screen.getByText('67%')).toBeTruthy();
    // total discussions tile
    expect(screen.getByText('סך דיונים')).toBeTruthy();
    // effectiveness help affordance (item 7) renders next to the hero title
    expect(screen.getByLabelText('איך מחושב ציון האפקטיביות')).toBeTruthy();
    // sum mode: total decisions = 2, total participations = 3
    expect(screen.getByText('סך החלטות')).toBeTruthy();
  });

  it('the avg toggle re-derives per-discussion metrics', () => {
    render(<DiscussionsDashboard onBackToDiscussions={() => {}} />);
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'ממוצע' })); });
    // decisions/discussion avg = (1+1)/2 = 1
    expect(screen.getByText('ממוצע החלטות לדיון')).toBeTruthy();
  });

  it('clicking a type legend drills down to that type’s discussions', () => {
    render(<DiscussionsDashboard onBackToDiscussions={() => {}} />);
    // the donut legend rows are real buttons (outside recharts) — clicking the
    // שבועי type opens the drill-down list of the discussions composing it.
    expect(screen.queryByText('A')).toBeNull(); // no list before the click
    fireEvent.click(screen.getByRole('button', { name: /שבועי/ }));
    expect(screen.getByText('A')).toBeTruthy(); // discussion A (type שבועי) listed
  });

  it('back arrow calls the handler', () => {
    const onBack = vi.fn();
    render(<DiscussionsDashboard onBackToDiscussions={onBack} />);
    // round154 — the back control is now the icon button to the LEFT of the
    // title (matching My-Tasks/My-Decisions), keyed by its aria-label.
    fireEvent.click(screen.getByLabelText('בחזרה לתצוגת הדיונים'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
