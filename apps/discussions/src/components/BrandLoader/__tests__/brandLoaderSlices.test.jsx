import React from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { BrandLoader } from '../BrandLoader.jsx';

// Round 45 — the central "pizza" must read as 8 equal slices: 8 WHITE radial
// cut lines, one every 45°. This guards the count so it can never silently drop
// back to reading as 4 wedges.
describe('BrandLoader — the pizza is cut into exactly 8 slices', () => {
  it('renders exactly 8 radial cut lines (8 wedges)', () => {
    const { container } = render(<BrandLoader />);
    const cuts = container.querySelectorAll('line');
    expect(cuts.length).toBe(8);
  });

  it('draws the 8 cuts in white so they stay high-contrast on the gradient disc', () => {
    const { container } = render(<BrandLoader />);
    const cutGroup = container.querySelector('line')?.parentElement;
    expect(cutGroup?.getAttribute('stroke')).toBe('#ffffff');
  });

  it('still renders the branded splash (status role + "Meetings" wordmark)', () => {
    const { getByRole, getByText } = render(<BrandLoader />);
    expect(getByRole('status', { name: 'טוען' })).toBeTruthy();
    expect(getByText('Meetings')).toBeTruthy();
  });
});
