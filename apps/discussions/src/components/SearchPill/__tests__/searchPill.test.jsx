import React, { useState } from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SearchPill, matchesSearch } from '../SearchPill.jsx';

// round132 — shared toolbar Search pill (tasks / previous / topics / decisions).

describe('matchesSearch', () => {
  it('an empty or blank term matches everything', () => {
    expect(matchesSearch('משימה כלשהי', '')).toBe(true);
    expect(matchesSearch('משימה כלשהי', '   ')).toBe(true);
    expect(matchesSearch('', null)).toBe(true);
  });

  it('matches case-insensitively on "contains" and rejects non-matches', () => {
    expect(matchesSearch('Prepare Budget Review', 'budget')).toBe(true);
    expect(matchesSearch('סיכום פגישת צוות', 'פגישת')).toBe(true);
    expect(matchesSearch('סיכום פגישת צוות', 'תקציב')).toBe(false);
    // a null name never matches a real term
    expect(matchesSearch(null, 'x')).toBe(false);
  });
});

function Harness() {
  const [value, setValue] = useState('');
  return <SearchPill value={value} onChange={setValue} />;
}

describe('SearchPill', () => {
  it('renders a collapsed pill, expands to an input on click', () => {
    render(<Harness />);
    const pill = screen.getByRole('button', { name: 'Search' });
    expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.click(pill);
    expect(screen.getByRole('textbox')).toBeTruthy();
  });

  it('typing updates the value; the clear-X empties it and keeps the input open', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'תקציב' } });
    expect(input.value).toBe('תקציב');
    fireEvent.click(screen.getByRole('button', { name: 'נקה חיפוש' }));
    expect(screen.getByRole('textbox').value).toBe('');
  });

  it('blur with an empty value collapses back to the pill; with a value it stays open', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'א' } });
    fireEvent.blur(input);
    expect(screen.getByRole('textbox')).toBeTruthy(); // value present -> stays expanded
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } });
    fireEvent.blur(screen.getByRole('textbox'));
    expect(screen.queryByRole('textbox')).toBeNull(); // empty -> collapses
    expect(screen.getByRole('button', { name: 'Search' })).toBeTruthy();
  });
});
