process.env.TZ = 'Asia/Jerusalem';

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, fireEvent, act } from '@testing-library/react';

const mockItems = vi.hoisted(() => [{
  id: '1',
  name: 'דיון בדיקה',
  discussionDateID: Object.assign(new Date(2026, 5, 10, 14, 0), { hasTime: true }),
}]);

vi.mock('@generated/hooks/useDiscussions', () => ({
  useDiscussions: () => ({
    items: mockItems,
    loading: false,
    refetching: false,
    loadingMore: false,
    cursor: null,
    loadMore: vi.fn(),
    softDeleteDiscussion: vi.fn(() => ({ undo: vi.fn() })),
  }),
  useDiscussionMonths: () => ({ months: [], loading: false }),
}));

vi.mock('@api/BoardSDK.js', () => ({
  דיונים1Board: class {
    aggregate() {
      return {
        groupBy: () => ({
          countItems: () => ({ execute: async () => [] }),
        }),
      };
    }
  },
}));

import { DiscussionList } from '../DiscussionList';

const anchor = new Date(2026, 5, 10);

function renderCalendarList(overrides = {}) {
  return render(
    <DiscussionList
      onSelect={vi.fn()}
      selectedId={null}
      onCreateNew={vi.fn()}
      onEdit={vi.fn()}
      onDuplicate={vi.fn()}
      onExport={vi.fn()}
      onDelete={vi.fn()}
      viewMode="calendar"
      onViewModeChange={vi.fn()}
      calendarAnchor={anchor}
      calendarMode="month"
      onCalendarNavigate={vi.fn()}
      {...overrides}
    />
  );
}

describe('DiscussionList calendar view header', () => {
  // round180+ redesign — the calendar + list share ONE unified control bar
  // (`filter-bar`); type/month filters live in a popover opened by the "סינון"
  // button. The month filter is still gated `!isCalendar` (the calendar grid
  // navigates months itself), so the original intent holds in the new structure:
  // calendar view offers search + the TYPE filter but NOT the month filter.
  it('calendar header: offers search + type filter, hides the month filter', async () => {
    renderCalendarList();
    await act(async () => { await Promise.resolve(); });
    const bar = screen.getByTestId('filter-bar');
    // search stays available in calendar view
    expect(within(bar).getByRole('textbox', { name: 'חיפוש דיון' })).toBeTruthy();
    // open the filter popover
    fireEvent.click(within(bar).getByRole('button', { name: 'סינון' }));
    // type filter is offered…
    expect(screen.getByRole('button', { name: 'סינון לפי סוג' })).toBeTruthy();
    // …but the MONTH filter is hidden in calendar view (the grid navigates months)
    expect(screen.queryByRole('button', { name: 'סינון לפי חודש' })).toBeNull();
  });

  it('renders the calendar grid with filtered items', async () => {
    renderCalendarList();
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText('יוני 2026')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'דיון בדיקה' })).toBeTruthy();
  });
});

describe('DiscussionList calendar rowActions wiring', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('surfaces row actions on chip hover when handlers are provided', async () => {
    renderCalendarList();
    fireEvent.mouseEnter(screen.getByRole('button', { name: 'דיון בדיקה' }));
    await act(async () => { vi.advanceTimersByTime(200); });
    const menu = screen.getByRole('menu');
    expect(within(menu).getByText('דיון בדיקה')).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: /עריכה/ })).toBeTruthy();
  });

  it('does not open a hover menu when no action handlers are provided', async () => {
    renderCalendarList({ onEdit: null, onDuplicate: null, onExport: null, onDelete: null });
    fireEvent.mouseEnter(screen.getByRole('button', { name: 'דיון בדיקה' }));
    await act(async () => { vi.advanceTimersByTime(200); });
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
