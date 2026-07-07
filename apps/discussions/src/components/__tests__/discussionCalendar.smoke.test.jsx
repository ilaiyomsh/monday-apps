process.env.TZ = 'Asia/Jerusalem';

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, fireEvent, act } from '@testing-library/react';
import { DiscussionCalendar } from '../DiscussionCalendar';
import { composeLocalDate } from '../../utils/dateTime.js';

const noop = () => {};
// Different days (same week) — jsdom cells have zero height, so a month cell
// fits exactly one chip; one item per day keeps both visible.
const items = [
  { id: '1', name: 'דיון מתוזמן', discussionDateID: composeLocalDate('2026-06-10', '14:00') },
  { id: '2', name: 'דיון כל היום', discussionDateID: composeLocalDate('2026-06-11', '') },
];

function renderCal(mode) {
  return render(
    <DiscussionCalendar
      items={items}
      loading={false}
      refetching={false}
      selectedId={null}
      anchor={new Date(2026, 5, 10)}
      mode={mode}
      onNavigate={noop}
      onSelect={noop}
      onCreateAt={noop}
    />
  );
}

describe('DiscussionCalendar month view', () => {
  it('renders the Hebrew month title, nav and both chips', () => {
    renderCal('month');
    expect(screen.getByText('יוני 2026')).toBeTruthy();
    expect(screen.getByText('היום')).toBeTruthy();
    expect(screen.getByText('חודשי')).toBeTruthy();
    expect(screen.getByText('שבוע עבודה')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'דיון מתוזמן' }).length).toBe(1);
    expect(screen.getAllByRole('button', { name: 'דיון כל היום' }).length).toBe(1);
  });

  it('clicking a day cell navigates to the work-week view', () => {
    const onNavigate = vi.fn();
    render(
      <DiscussionCalendar
        items={[]}
        loading={false}
        refetching={false}
        selectedId={null}
        anchor={new Date(2026, 5, 10)}
        mode="month"
        onNavigate={onNavigate}
        onSelect={noop}
        onCreateAt={noop}
      />
    );
    screen.getAllByRole('button', { name: /מעבר לשבוע עבודה/ })[10].click();
    expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({ mode: 'week' }));
  });
});

describe('DiscussionCalendar work-week view', () => {
  it('renders Sun..Thu only, the hour gutter (06:00-23:00), and timed chips', () => {
    renderCal('week');
    // No all-day strip — every discussion now carries an hour.
    expect(screen.queryByText('כל היום')).toBeNull();
    // Gutter runs 06:00..23:00; 07:00 is the default first-visible hour.
    expect(screen.getByText('06:00')).toBeTruthy();
    expect(screen.getByText('07:00')).toBeTruthy();
    expect(screen.getByText('23:00')).toBeTruthy();
    expect(screen.getByText('7–11 ביוני 2026')).toBeTruthy();
    // Five work-day headers (Sun..Thu); Fri/Sat are omitted.
    expect(screen.queryAllByText('ו׳')).toHaveLength(0);
    expect(screen.queryAllByText('ש׳')).toHaveLength(0);
    expect(screen.getAllByText(/^([א-ה]׳)$/)).toHaveLength(5);
    // Untimed discussions no longer surface in the week view.
    expect(screen.queryByRole('button', { name: 'דיון כל היום' })).toBeNull();
    const timedChip = screen.getByRole('button', { name: 'דיון מתוזמן' });
    expect(within(timedChip).getByText('14:00')).toBeTruthy();
  });

  it('clicking an empty hour slot reports the slot date+time', () => {
    const onCreateAt = vi.fn();
    render(
      <DiscussionCalendar
        items={[]}
        loading={false}
        refetching={false}
        selectedId={null}
        anchor={new Date(2026, 5, 10)}
        mode="week"
        onNavigate={noop}
        onSelect={noop}
        onCreateAt={onCreateAt}
      />
    );
    // Wednesday 2026-06-10 at 14:00
    screen.getByRole('button', { name: 'צור דיון חדש — יום רביעי 10 ביוני בשעה 14:00' }).click();
    expect(onCreateAt).toHaveBeenCalledWith({ date: '2026-06-10', time: '14:00' });
  });
});

describe('DiscussionCalendar chip hover actions', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('opens a hover menu with the full name and row actions', async () => {
    const onEdit = vi.fn();
    render(
      <DiscussionCalendar
        items={items}
        loading={false}
        refetching={false}
        selectedId={null}
        anchor={new Date(2026, 5, 10)}
        mode="month"
        onNavigate={noop}
        onSelect={noop}
        onCreateAt={noop}
        rowActions={{ onEdit, onDuplicate: vi.fn(), onExport: vi.fn(), onDelete: vi.fn(), exportingId: null }}
      />
    );
    fireEvent.mouseEnter(screen.getByRole('button', { name: 'דיון מתוזמן' }));
    await act(async () => { vi.advanceTimersByTime(200); });
    const menu = screen.getByRole('menu');
    expect(within(menu).getByText('דיון מתוזמן')).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: /עריכה/ })).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: /שכפול/ })).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: /ייצוא/ })).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: /מחיקה/ })).toBeTruthy();
  });
});
