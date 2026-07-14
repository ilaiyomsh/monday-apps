// PersonPicker — unit tests for the single-select display contract used by the
// on-click dialog: the current selection shows as a removable chip, is dropped
// from the suggestions list, picking another replaces it, and search matches
// any part of the name (first OR last). Roster is passed via `users`, so no
// network fetch runs.

import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

import PersonPicker from './PersonPicker.jsx';

const ILAI = { id: 48274917, name: 'עילי שלם', photo_thumb: null };
const IDO = { id: 11111111, name: 'עידו פיוטרקובסקי', photo_thumb: null };
const RONI = { id: 96863017, name: 'רוני ארגמן', photo_thumb: null };
const USERS = [ILAI, IDO, RONI];

const selectedIlai = () => [{ id: ILAI.id, name: ILAI.name, kind: 'person' }];

const searchInput = () => screen.getByLabelText('חיפוש שם');

afterEach(() => cleanup());

describe('PersonPicker — single-select display', () => {
  it('shows the selected person as a removable chip; clicking the X clears the selection', () => {
    const onChange = vi.fn();
    render(
      <PersonPicker inline single hideSelectedInList users={USERS} selected={selectedIlai()} onChange={onChange} />
    );

    const remove = screen.getByLabelText('הסר עילי שלם');
    expect(remove).toBeInTheDocument();

    fireEvent.click(remove);
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('drops the selected person from the suggestions list — they appear ONLY as the chip', () => {
    render(
      <PersonPicker inline single hideSelectedInList users={USERS} selected={selectedIlai()} onChange={() => {}} />
    );

    // "עילי שלם" appears exactly once (the chip), never as a list row.
    expect(screen.getAllByText('עילי שלם')).toHaveLength(1);
    // The other members ARE offered in the list.
    expect(screen.getByText('רוני ארגמן')).toBeInTheDocument();
    expect(screen.getByText('עידו פיוטרקובסקי')).toBeInTheDocument();
  });

  it('renders NO checkmark in the list rows (the ✓ indicator was removed)', () => {
    const { container } = render(
      <PersonPicker inline single hideSelectedInList users={USERS} selected={[]} onChange={() => {}} />
    );
    // The check indicator lived in a span.check; it must no longer render.
    expect(container.querySelector('[class*="check"]')).toBeNull();
  });

  it('single mode: picking another person REPLACES the current one', () => {
    const onChange = vi.fn();
    render(
      <PersonPicker inline single hideSelectedInList users={USERS} selected={selectedIlai()} onChange={onChange} />
    );

    fireEvent.click(screen.getByText('רוני ארגמן').closest('button'));

    expect(onChange).toHaveBeenCalledWith([{ id: RONI.id, kind: 'person', name: RONI.name }]);
  });
});

describe('PersonPicker — search matches first OR last name', () => {
  it('"ש" surfaces "עילי שלם" (ש is only in the surname) and nothing else', () => {
    render(<PersonPicker inline single users={USERS} selected={[]} onChange={() => {}} />);

    fireEvent.change(searchInput(), { target: { value: 'ש' } });

    expect(screen.getByText('עילי שלם')).toBeInTheDocument();
    expect(screen.queryByText('עידו פיוטרקובסקי')).toBeNull();
    expect(screen.queryByText('רוני ארגמן')).toBeNull();
  });

  it('"ע" surfaces both people whose FIRST name starts with ע, but not רוני', () => {
    render(<PersonPicker inline single users={USERS} selected={[]} onChange={() => {}} />);

    fireEvent.change(searchInput(), { target: { value: 'ע' } });

    expect(screen.getByText('עילי שלם')).toBeInTheDocument();
    expect(screen.getByText('עידו פיוטרקובסקי')).toBeInTheDocument();
    expect(screen.queryByText('רוני ארגמן')).toBeNull();
  });
});
