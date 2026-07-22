import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ExternalPeople } from '../ExternalPeople.jsx';

/*
 * round211 — external participants avatars + editor. Pinned:
 *   · every name renders as an initials avatar whose FULL name shows on hover
 *     (native title) — the owner-specified affordance.
 *   · read-only viewers get the avatars but no "+" editor; with nothing to show
 *     the component renders nothing.
 *   · the editor adds (Enter/הוסף) and removes (✕) names via onChange(names).
 */
describe('ExternalPeople', () => {
  it('renders an initials avatar per name with the full name as hover title', () => {
    const { container } = render(<ExternalPeople names={['יוסי כהן', 'דנה לוי']} />);
    const tips = container.querySelectorAll('[title]');
    expect([...tips].map((el) => el.getAttribute('title'))).toEqual(['יוסי כהן', 'דנה לוי']);
    expect(screen.getByText('יכ')).toBeInTheDocument();
    expect(screen.getByText('דל')).toBeInTheDocument();
  });

  it('read-only: no "+" editor; and renders nothing when empty', () => {
    const { container, rerender } = render(<ExternalPeople names={['א ב']} canEdit={false} />);
    expect(screen.queryByRole('button', { name: 'עריכת משתתפים' })).not.toBeInTheDocument();
    rerender(<ExternalPeople names={[]} canEdit={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('editor: adds a typed name on Enter and removes via ✕, reporting the full list', () => {
    const onChange = vi.fn();
    render(<ExternalPeople names={['יוסי כהן']} canEdit onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'עריכת משתתפים' }));

    const input = screen.getByLabelText('שם משתתף חיצוני');
    fireEvent.change(input, { target: { value: ' דנה לוי ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(['יוסי כהן', 'דנה לוי']);

    fireEvent.click(screen.getByRole('button', { name: 'הסרת יוסי כהן' }));
    expect(onChange).toHaveBeenCalledWith([]);
  });
});
