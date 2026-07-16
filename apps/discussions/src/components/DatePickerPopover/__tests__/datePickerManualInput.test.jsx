import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

// Round 47 — the shared DatePickerPopover gained a typeable DD/MM/YYYY field at
// the TOP of the popover. We mock @vibe's Dialog to render its `content()`
// inline and auto-fire onDialogDidShow (so `open` is true and the field
// pre-fills), plus stub the calendar/icon, to exercise the manual-input flow
// without depending on the real portal/positioning.
vi.mock('@vibe/core', async () => {
  const R = await import('react');
  return {
    Dialog: ({ children, content, onDialogDidShow }) => {
      R.useEffect(() => { if (onDialogDidShow) onDialogDidShow(); }, []);
      return R.createElement(R.Fragment, null, children, content ? content() : null);
    },
    DialogContentContainer: ({ children }) => R.createElement('div', null, children),
    DatePicker: () => null,
    Button: ({ children, onClick }) => R.createElement('button', { type: 'button', onClick }, children),
  };
});
vi.mock('@vibe/icons', () => ({ Calendar: () => null }));
vi.mock('@generated/utils/overlayPlacement', () => ({
  computeFloatingPosition: () => ({ placement: 'bottom-start' }),
}));

import { DatePickerPopover, parseTypedDate } from '../DatePickerPopover.jsx';

describe('parseTypedDate (round 47 manual entry)', () => {
  const ymd = (d) => [d.getFullYear(), d.getMonth() + 1, d.getDate()];

  it('parses the canonical DD/MM/YYYY', () => {
    expect(ymd(parseTypedDate('20/06/2026'))).toEqual([2026, 6, 20]);
  });
  it('is lenient about separators (. - and spaces)', () => {
    expect(ymd(parseTypedDate('20.06.2026'))).toEqual([2026, 6, 20]);
    expect(ymd(parseTypedDate('20-6-2026'))).toEqual([2026, 6, 20]);
    expect(ymd(parseTypedDate('  20 6 2026 '))).toEqual([2026, 6, 20]);
  });
  it('expands a 2-digit year and defaults a missing year to the current year', () => {
    expect(ymd(parseTypedDate('05/03/26'))).toEqual([2026, 3, 5]);
    expect(parseTypedDate('7/8').getFullYear()).toBe(new Date().getFullYear());
    expect(ymd(parseTypedDate('7/8')).slice(1)).toEqual([8, 7]);
  });
  it('rejects impossible / malformed dates (no silent JS overflow)', () => {
    expect(parseTypedDate('31/02/2026')).toBeNull(); // Feb 31 does not exist
    expect(parseTypedDate('00/06/2026')).toBeNull();
    expect(parseTypedDate('20/13/2026')).toBeNull();
    expect(parseTypedDate('99/99/9999')).toBeNull();
    expect(parseTypedDate('hello')).toBeNull();
    expect(parseTypedDate('')).toBeNull();
    expect(parseTypedDate(null)).toBeNull();
    expect(parseTypedDate('1/2/3/4')).toBeNull();
  });
});

describe('DatePickerPopover — segmented DD/MM/YY manual entry (round 71)', () => {
  const group = () => screen.getByLabelText('הקלדת תאריך');
  const dd = () => screen.getByLabelText('יום');
  const mm = () => screen.getByLabelText('חודש');
  const yy = () => screen.getByLabelText('שנה');

  it('renders the static slashes and pre-fills segments with the current value (2-digit year)', async () => {
    render(<DatePickerPopover value={new Date(2025, 2, 15)} onChange={vi.fn()} />);
    await waitFor(() => expect(dd().value).toBe('15'));
    expect(mm().value).toBe('03');
    expect(yy().value).toBe('25');
    // the two separators are always in the DOM, independent of typing
    expect(group().textContent.match(/\//g)).toHaveLength(2);
  });

  it('auto-commits once day+month+year are filled (digits land per segment)', () => {
    const onChange = vi.fn();
    render(<DatePickerPopover value={null} onChange={onChange} />);
    fireEvent.change(dd(), { target: { value: '20' } });
    fireEvent.change(mm(), { target: { value: '06' } });
    expect(onChange).not.toHaveBeenCalled(); // year still empty — nothing committed
    fireEvent.change(yy(), { target: { value: '26' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    const d = onChange.mock.calls[0][0];
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate()]).toEqual([2026, 6, 20]);
  });

  it('zero-pads an unambiguous first digit (day 4 → 04)', () => {
    render(<DatePickerPopover value={null} onChange={vi.fn()} />);
    fireEvent.change(dd(), { target: { value: '4' } });
    expect(dd().value).toBe('04');
  });

  it('commits a day/month-only entry on Enter, defaulting the year', () => {
    const onChange = vi.fn();
    render(<DatePickerPopover value={null} onChange={onChange} />);
    fireEvent.change(dd(), { target: { value: '20' } });
    fireEvent.change(mm(), { target: { value: '06' } });
    fireEvent.keyDown(mm(), { key: 'Enter' });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].getFullYear()).toBe(new Date().getFullYear());
  });

  it('does NOT commit an impossible date and flags the invalid state', () => {
    const onChange = vi.fn();
    render(<DatePickerPopover value={null} onChange={onChange} />);
    fireEvent.change(dd(), { target: { value: '31' } });
    fireEvent.change(mm(), { target: { value: '02' } });
    fireEvent.change(yy(), { target: { value: '26' } }); // 31/02 does not exist
    expect(onChange).not.toHaveBeenCalled();
    expect(group().getAttribute('aria-invalid')).toBe('true');
  });

  it('strips non-digit input inside a segment', () => {
    render(<DatePickerPopover value={null} onChange={vi.fn()} />);
    fireEvent.change(dd(), { target: { value: '1a' } });
    expect(dd().value).toBe('1');
  });
});
