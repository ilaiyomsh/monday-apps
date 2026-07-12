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

describe('DatePickerPopover — manual date input (round 47)', () => {
  const field = () => screen.getByLabelText('הקלדת תאריך');

  it('pre-fills the field with the current value (DD/MM/YYYY)', async () => {
    render(<DatePickerPopover value={new Date(2025, 2, 15)} onChange={vi.fn()} />);
    await waitFor(() => expect(field().value).toBe('15/03/2025'));
  });

  it('commits a valid typed date on Enter via onChange', () => {
    const onChange = vi.fn();
    render(<DatePickerPopover value={null} onChange={onChange} />);
    fireEvent.change(field(), { target: { value: '20/06/2026' } });
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(onChange).toHaveBeenCalledTimes(1);
    const d = onChange.mock.calls[0][0];
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate()]).toEqual([2026, 6, 20]);
  });

  it('does NOT commit an invalid entry and flags the invalid state', () => {
    const onChange = vi.fn();
    render(<DatePickerPopover value={null} onChange={onChange} />);
    fireEvent.change(field(), { target: { value: '31/02/2026' } });
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
    expect(field().getAttribute('aria-invalid')).toBe('true');
  });
});
