import React from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

// Hermetic: don't reach the users store / monday API — names come from the prop.
vi.mock('@api/hooks/use-users', () => ({ useUsers: () => ({ users: [], loading: false }) }));

import { PersonList } from '../PersonAvatar.jsx';

const people = (n) => Array.from({ length: n }, (_, i) => ({ id: String(i + 1), name: `איש ${i + 1}` }));

describe('PersonList — compact people column never wraps (round263)', () => {
  it('shows up to `max` avatars + a single "+N" overflow chip (8 people, max 2 ⇒ 2 + "+6")', () => {
    render(<PersonList people={people(8)} size="sm" showNames={false} max={2} />);
    const stack = document.querySelector('.compactStack');
    expect(stack).toBeTruthy();
    // 2 avatars + 1 overflow chip = 3 stack items, on one line (no wrap).
    expect(stack.querySelectorAll('.stackItem')).toHaveLength(3);
    const chip = document.querySelector('.overflowChip');
    expect(chip).toBeTruthy();
    expect(chip.textContent).toBe('+6');
  });

  it('shows NO overflow chip when everyone fits within `max`', () => {
    render(<PersonList people={people(2)} size="sm" showNames={false} max={3} />);
    expect(document.querySelectorAll('.compactStack .stackItem')).toHaveLength(2);
    expect(document.querySelector('.overflowChip')).toBeNull();
  });

  it('renders the monday "unassigned" glyph when there are no people', () => {
    render(<PersonList people={[]} size="sm" showNames={false} max={3} />);
    expect(document.querySelector('.compactStack')).toBeNull();
    expect(document.querySelector('.emptyAvatar')).toBeTruthy();
  });
});
