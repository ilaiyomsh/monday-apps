import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import '../i18n';
import { MonthCalendar, type CalChip } from '../components/ui/MonthCalendar';

// June 2026: Jun 1 is a Monday → week 1 = May31(Sun)..Jun6(Sat); week 2 = Jun7(Sun)..Jun13(Sat).
const monthDate = new Date(2026, 5, 1);

const rangeChips = (key: string, start: string, end: string): CalChip[] =>
  key >= start && key <= end ? [{ key: 'r1', kind: 'absence', label: 'X', color: 'red', start, end }] : [];

describe('MonthCalendar — spanning bars', () => {
  it('renders one continuous bar for a multi-day event within a single week', () => {
    // Jun 9..11 (Tue..Thu) sit in week 2 at columns 2,3,4 → grid-column "3 / span 3".
    const { container } = render(
      <MonthCalendar monthDate={monthDate} chipsFor={(k) => rangeChips(k, '2026-06-09', '2026-06-11')} />,
    );
    const bars = container.querySelectorAll('.cal-bar');
    expect(bars.length).toBe(1);
    expect((bars[0] as HTMLElement).style.gridColumn).toContain('span 3');
    // a self-contained event is rounded on both ends
    expect(container.querySelector('.cal-bar.cont-start')).toBeNull();
    expect(container.querySelector('.cal-bar.cont-end')).toBeNull();
  });

  it('splits a cross-week event into two segments that continue across the boundary', () => {
    // Jun 5..8: Fri,Sat (week1 cols 5,6) + Sun,Mon (week2 cols 0,1).
    const { container } = render(
      <MonthCalendar monthDate={monthDate} chipsFor={(k) => rangeChips(k, '2026-06-05', '2026-06-08')} />,
    );
    const bars = Array.from(container.querySelectorAll('.cal-bar')) as HTMLElement[];
    expect(bars.length).toBe(2);
    bars.forEach((b) => expect(b.style.gridColumn).toContain('span 2'));
    // week-1 segment continues forward; week-2 segment continues from before
    expect(container.querySelector('.cal-bar.cont-end')).toBeTruthy();
    expect(container.querySelector('.cal-bar.cont-start')).toBeTruthy();
  });

  it('packs overlapping events onto separate lanes', () => {
    const chips = (k: string): CalChip[] => [
      ...rangeChips(k, '2026-06-09', '2026-06-11'),
      ...(k >= '2026-06-10' && k <= '2026-06-12'
        ? [{ key: 'r2', kind: 'absence' as const, label: 'Y', color: 'blue', start: '2026-06-10', end: '2026-06-12' }]
        : []),
    ];
    const { container } = render(<MonthCalendar monthDate={monthDate} chipsFor={chips} />);
    const bars = Array.from(container.querySelectorAll('.cal-bar')) as HTMLElement[];
    expect(bars.length).toBe(2);
    const rows = new Set(bars.map((b) => b.style.gridRow));
    expect(rows.size).toBe(2); // different lanes
  });
});
