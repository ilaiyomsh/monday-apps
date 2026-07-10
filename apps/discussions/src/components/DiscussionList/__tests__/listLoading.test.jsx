import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

// Force the loading branch so only the initial-load placeholder renders.
vi.mock('@generated/hooks/useDiscussions', () => ({
  useDiscussions: () => ({
    items: [],
    loading: true,
    refetching: false,
    loadingMore: false,
    cursor: null,
    loadMore: () => {},
    softDeleteDiscussion: () => {},
  }),
}));

vi.mock('@generated/hooks/useStatusOptions.js', () => ({
  useStatusOptions: () => ({ options: [], colorById: {} }),
}));

import { DiscussionList } from '../DiscussionList.jsx';

// Round 36: the discussions list initial load now shows the branded BrandLoader
// splash (an animated "round table" mark + "Powered by Twyst") in place of the
// old grey skeleton bars.
describe('DiscussionList — initial list load shows the branded splash', () => {
  it('renders the BrandLoader (status role + "Powered by Twyst") while loading', () => {
    render(<DiscussionList onSelect={() => {}} />);
    expect(screen.getByRole('status', { name: 'טוען' })).toBeTruthy();
    expect(screen.getByText('Powered by Twyst')).toBeTruthy();
  });

  it('no longer renders the old grey skeleton bars', () => {
    const { container } = render(<DiscussionList onSelect={() => {}} />);
    expect(container.querySelectorAll('[data-testid="skeleton"]').length).toBe(0);
  });
});
