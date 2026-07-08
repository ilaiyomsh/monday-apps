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
  it('places search and type filter on one row without the month filter', async () => {
    renderCalendarList();
    await act(async () => { await Promise.resolve(); });
    const row = screen.getByTestId('calendar-filter-row');
    expect(within(row).getByRole('textbox', { name: 'חיפוש דיון' })).toBeTruthy();
    expect(within(row).getByRole('button', { name: 'סינון לפי סוג' })).toBeTruthy();
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
